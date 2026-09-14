// Client-half logic smoke test for dsh-sound (run with: node tools/test-client.mjs)
// Simulates the browser module loader + a fake ctx; observes synthesized audio via fake AudioContext
// (oscillator frequency capture), config from a fake localStorage, UI via a fake React.
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let failures = 0
const ok = (cond, label) => {
  if (cond) console.log('PASS', label)
  else { failures++; console.log('FAIL', label) }
}

// builtin first-fundamental frequencies (ding/chime/bell/complete/success)
const FREQ = { ding: 698.46, chime: 880, bell: 493.88, complete: 523.25, success: 783.99 }

// ----- fresh environment per scenario -----
function makeEnv(seededConfig, withMux, withBroadcast, noAudioContext) {
  const registered = {}
  let oscCount = 0
  let decodedCount = 0
  const freqs = []
  const gains = []
  const audioPlays = []
  const bufferPlays = []
  const xhrUrls = []
  const timers = []
  const storage = new Map()
  storage.set('dsh-sound:config', JSON.stringify(seededConfig || {}))
  let timerSeq = 0
  const bcInstances = new Map() // channel name -> instances（每个 env 独立注册表）
  const fakeWindow = {
    __ModuleLoader__: { load: (entry) => { registered[entry.id] = entry } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, v) },
    },
    setTimeout: (fn, ms) => {
      const t = { id: ++timerSeq, fn, ms: typeof ms === 'number' ? ms : 0, cleared: false, fired: false }
      timers.push(t)
      return t.id
    },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true },
    BroadcastChannel: withBroadcast ? class {
      constructor(name) {
        this.name = name
        if (!bcInstances.has(name)) bcInstances.set(name, [])
        bcInstances.get(name).push(this)
      }
      postMessage(data) {
        const list = bcInstances.get(this.name) || []
        for (const other of list) {
          if (other !== this && typeof other.onmessage === 'function') other.onmessage({ data })
        }
      }
    } : undefined,
    AudioContext: noAudioContext ? undefined : class {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
      resume() { return Promise.resolve() }
      decodeAudioData(buf, ok, err) { decodedCount++; ok({ duration: 1 }) }
      createBufferSource() {
        return { buffer: null, connect() {}, start() { bufferPlays.push(this.buffer) } }
      }
      createOscillator() {
        oscCount++
        return {
          type: 'sine',
          frequency: {
            setValueAtTime: (f) => { freqs.push(f) },
            exponentialRampToValueAtTime() {},
          },
          connect() {}, start() {}, stop() {},
        }
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime: (v) => { gains.push(v) } }, connect() {} }
      }
    },
    XMLHttpRequest: class {
      open(method, url, async) { this.url = url }
      send() {
        xhrUrls.push(this.url)
        this.status = 200
        this.response = new ArrayBuffer(8)
        if (this.onload) this.onload()
      }
    },
    Audio: class {
      constructor(url) { this.url = url }
      play() { audioPlays.push(this.url); return Promise.resolve() }
    },
    FileReader: class {},
  }
  const created = []
  const hookState = []
  let hookCursor = 0
  const react = {
    createElement: (type, props, ...children) => {
      const node = { type, props: props || {}, children }
      created.push(node)
      // 模拟 React 渲染函数组件（EventRow / SoundRadioGroup / LocalFileRow 是子组件）
      if (typeof type === 'function') return type(Object.assign({}, props, { children }))
      return node
    },
    useState: (v) => {
      const i = hookCursor++
      if (hookState[i] === undefined) hookState[i] = typeof v === 'function' ? v() : v
      return [
        hookState[i],
        (nv) => { hookState[i] = typeof nv === 'function' ? nv(hookState[i]) : nv },
      ]
    },
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }

  // evaluate the classic bundle script
  const factoryFn = new Function('window', source + '\n')
  factoryFn(fakeWindow)
  const entry = registered['@ai-galaxy/dsh-sound']
  if (!entry) throw new Error('client bundle must register under the package name (@ai-galaxy/dsh-sound)')
  const exportsObj = entry.factory((spec) => (spec === 'react' ? react : undefined))

  // mutable session store
  let sessionsSnap = {
    ids: ['s1'],
    byId: { s1: { id: 's1', running: false } },
    current: 's1',
    jobsBySession: {},
  }
  let sessionsSub = null
  let effectDisposer = null
  let slotReg = null
  let activeLocale = 'zh'
  const languages = new Map([['zh', { id: 'zh' }], ['en', { id: 'en' }]].concat((seededConfig && seededConfig._localeLanguages) || []))
  const dictionaries = new Map()
  const locale = {
    addLanguage(language) {
      if (languages.has(language.id)) throw new Error('duplicate language: ' + language.id)
      languages.set(language.id, language)
      return () => languages.delete(language.id)
    },
    register(namespace, language, dictionary) {
      dictionaries.set(namespace + '/' + language, dictionary)
      return () => dictionaries.delete(namespace + '/' + language)
    },
    bind(namespace) {
      return (key) => {
        const current = dictionaries.get(namespace + '/' + activeLocale)
        const fallback = dictionaries.get(namespace + '/en')
        return (current && current[key]) || (fallback && fallback[key]) || key
      }
    },
    getLocale: () => ({ locales: Array.from(languages.values()) }),
    getSnapshot: () => ({ active: activeLocale, revision: 0 }),
    subscribe: () => () => {},
  }
  // 可控的 push 式 mux 异步迭代器
  const muxQueue = []
  const muxWaiters = []
  const muxIterable = {
    [Symbol.asyncIterator]() { return this },
    next() {
      if (muxQueue.length > 0) return Promise.resolve({ value: muxQueue.shift(), done: false })
      return new Promise((resolve) => muxWaiters.push(resolve))
    },
    return() { return Promise.resolve({ done: true }) },
  }
  const muxDeliver = (result) => {
    if (muxWaiters.length > 0) muxWaiters.shift()(result)
    else muxQueue.push(result)
  }
  const muxPush = (frame) => muxDeliver({ value: frame, done: false })
  const muxEnd = () => muxDeliver({ value: undefined, done: true })
  const hostQueue = []
  const hostWaiters = []
  const hostIterable = {
    [Symbol.asyncIterator]() { return this },
    next() {
      if (hostQueue.length > 0) return Promise.resolve({ value: hostQueue.shift(), done: false })
      return new Promise((resolve) => hostWaiters.push(resolve))
    },
    return() { return Promise.resolve({ done: true }) },
  }
  const hostDeliver = (result) => {
    if (hostWaiters.length > 0) hostWaiters.shift()(result)
    else hostQueue.push(result)
  }
  const hostPush = (frame) => hostDeliver({ value: frame, done: false })
  const ctx = {
    locale,
    sessions: {
      list: {
        getSnapshot: () => sessionsSnap,
        subscribe: (fn) => { sessionsSub = fn; return () => {} },
      },
    },
    effect: (fn) => { effectDisposer = fn() },
    slots: {
      inject: (name, cb) => { slotReg = { name, registration: cb() } },
      register: (opts, comp) => ({ opts, comp }),
    },
    connection: withMux
      ? { api: { events: { mux: () => muxIterable, host: () => hostIterable } } }
      : undefined,
  }

  const drive = (nextSessionsSnap) => {
    sessionsSnap = nextSessionsSnap
    if (sessionsSub) sessionsSub()
  }

  const row = (extra) => Object.assign({ id: 's1', running: false }, extra)

  const renderSection = (preserveHooks) => {
    created.length = 0
    hookCursor = 0
    if (!preserveHooks) hookState.length = 0
    const Section = slotReg && slotReg.registration && slotReg.registration.comp
    if (Section) Section({})
  }

  return {
    exportsObj,
    ctx,
    drive,
    row,
    getOscCount: () => oscCount,
    getDecodedCount: () => decodedCount,
    freqs,
    gains,
    audioPlays,
    bufferPlays,
    xhrUrls,
    getEffectDisposer: () => effectDisposer,
    getSlotReg: () => slotReg,
    setLocale: (id) => { activeLocale = id },
    languages,
    dictionaries,
    storage,
    created,
    renderUI: () => renderSection(false),
    rerenderUI: () => renderSection(true),
    timers,
    fireTimers: () => timers.forEach((t) => { if (!t.cleared && !t.fired) { t.fired = true; t.fn() } }),
    fireTimersMs: (ms) => timers.forEach((t) => {
      if (!t.cleared && !t.fired && t.ms === ms) { t.fired = true; t.fn() }
    }),
    pendingTimersMs: (ms) => timers.filter((t) => !t.cleared && !t.fired && t.ms === ms),
    muxPush,
    muxEnd,
    hostPush,
    setSessionIds: (ids) => { sessionsSnap.ids = ids },
    getBroadcastClass: () => fakeWindow.BroadcastChannel,
    countOf: (pred) => created.filter(pred).length,
  }
}

// ----- scenario 1: exports, slot registration, snapshot fallback turn end -----
{
  const env = makeEnv(undefined)
  ok(typeof env.exportsObj.apply === 'function', 'client exports apply')
  ok(Array.isArray(env.exportsObj.inject) && env.exportsObj.inject.includes('sessions'), 'client inject includes sessions')
  ok(env.exportsObj.inject.includes('connection'), 'client inject includes connection')
  ok(!env.exportsObj.inject.includes('workspaces'), 'client inject no longer includes workspaces')
  env.exportsObj.apply(env.ctx)
  const slotReg = env.getSlotReg()
  ok(slotReg && slotReg.name === 'settings.section', 'registered into settings.section slot')
  ok(slotReg.registration.opts.id === 'dsh-sound', 'section id dsh-sound')
  ok(typeof slotReg.registration.opts.label === 'function' && typeof slotReg.registration.opts.label() === 'string', 'section label thunk')
  ok(typeof env.getEffectDisposer() === 'function', 'watcher disposer returned')

  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() === 0, 'turn start produces no sound')
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.chime, 'turn end synthesized default completion chime')
}

// ----- scenario 2: quietCurrent skips the open session (completion only) -----
{
  const env = makeEnv({ enabled: true, quietCurrent: true })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() === 0, 'quietCurrent mutes the open session')
}

// ----- scenario 3: enabled=false silences everything -----
{
  const env = makeEnv({ enabled: false, quietCurrent: false })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() === 0, 'enabled=false silences')
}

// ----- scenario 4: completionSound data URL plays via Web Audio decode -----
{
  const env = makeEnv({ enabled: true, quietCurrent: false, completionSound: 'data:audio/mp3;base64,AAAA' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.audioPlays.length === 0, 'data URL does not use HTMLAudio (autoplay-blocked) path')
  ok(env.xhrUrls[0] === 'data:audio/mp3;base64,AAAA' && env.bufferPlays.length === 1, 'custom data URL decoded and played via Web Audio')
}

// ----- scenario 5: completionSound none mutes -----
{
  const env = makeEnv({ enabled: true, quietCurrent: false, completionSound: 'none' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() === 0 && env.audioPlays.length === 0, 'completionSound none mutes')
}

// ----- scenario 6: background job completion plays -----
{
  const env = makeEnv({ enabled: true, quietCurrent: false, completionSound: 'bell' })
  env.exportsObj.apply(env.ctx)
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false }) },
    current: 's1',
    jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] },
  })
  ok(env.getOscCount() === 0, 'job running produces no sound')
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false }) },
    current: 's1',
    jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'completed', startedAt: 1, finishedAt: 2 }] },
  })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.bell, 'job completion plays completionSound (bell)')
}

// ----- scenario 7: background job failure plays the failure sound instead of completion -----
{
  const env = makeEnv({ enabled: true, quietCurrent: false, completionSound: 'chime', failureSound: 'complete' })
  env.exportsObj.apply(env.ctx)
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false }) },
    current: 's1',
    jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] },
  })
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false }) },
    current: 's1',
    jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'failed', startedAt: 1, finishedAt: 2 }] },
  })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.complete, 'job failure plays failureSound (complete), not the chime')
}

// ----- scenario 8: default failure sound is bell -----
{
  const env = makeEnv({ enabled: true, quietCurrent: false })
  env.exportsObj.apply(env.ctx)
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false }) },
    current: 's1',
    jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] },
  })
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false }) },
    current: 's1',
    jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'failed', startedAt: 1, finishedAt: 2 }] },
  })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.bell, 'job failure default failureSound is bell')
}

// ----- scenario 9: approval pending plays the approval sound (default ding) -----
{
  const env = makeEnv({ enabled: true, quietCurrent: false, completionSound: 'chime' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false, pendingInteraction: 'approval' }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.ding, 'approval pending plays approvalSound (ding)')
}

// ----- scenario 10: per-kind approval sound override -----
{
  const env = makeEnv({ enabled: true, approvalSound: 'bell' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false, pendingInteraction: 'approval' }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.bell, 'approvalSound override plays bell')
}

// ----- scenario 11: attention events ignore quietCurrent -----
{
  const env = makeEnv({ enabled: true, quietCurrent: true })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false, pendingInteraction: 'approval' }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() > 0, 'attention events play even for the open session (quietCurrent ignored)')
}

// ----- scenario 12: question plays its own sound -----
{
  const env = makeEnv({ enabled: true, questionSound: 'success' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false, pendingInteraction: 'question' }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.success, 'question pending plays questionSound (success)')
}

// ----- scenario 13: plan-review pending plays its own sound -----
{
  const env = makeEnv({ enabled: true, planReviewSound: 'complete' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false, pendingInteraction: 'plan-review' }) }, current: 's1', jobsBySession: {} })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.complete, 'plan-review pending plays planReviewSound (complete)')
}

// ----- scenario 14: goal blocked transition plays once -----
{
  const env = makeEnv({ enabled: true })
  env.exportsObj.apply(env.ctx)
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false, projectionValues: { goal: { phase: 'active' } } }) },
    current: 's1',
    jobsBySession: {},
  })
  ok(env.getOscCount() === 0, 'goal active produces no sound')
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false, projectionValues: { goal: { phase: 'blocked' } } }) },
    current: 's1',
    jobsBySession: {},
  })
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.ding, 'goal blocked transition plays goalBlockedSound (ding)')
  const after = env.getOscCount()
  env.drive({
    ids: ['s1'],
    byId: { s1: env.row({ running: false, projectionValues: { goal: { phase: 'blocked' } } }) },
    current: 's1',
    jobsBySession: {},
  })
  ok(env.getOscCount() === after, 'goal staying blocked does not repeat')
}

// ----- scenario 15: per-event volume isolation -----
{
  const env = makeEnv({ enabled: true, completionVolume: 0.4, approvalVolume: 1 })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.gains.length > 0 && env.gains[0] === 0.22 * 0.4, 'completionVolume 0.4 scales chime gain to 0.088')
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false, pendingInteraction: 'approval' }) }, current: 's1', jobsBySession: {} })
  ok(env.gains.indexOf(0.3) >= 0, 'approvalVolume 1 keeps ding gain at 0.3')
}

// ----- scenario 16: no merge window — concurrent completions both play immediately -----
{
  const env = makeEnv({ enabled: true, completionSound: 'chime' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1', 's2'], byId: { s1: env.row({ running: true }), s2: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1', 's2'], byId: { s1: env.row({ running: false }), s2: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.timers.length === 0, 'no merge timers scheduled')
  ok(env.getOscCount() === 8, 'two concurrent completions both play immediately (2 x chime = 8 oscillators)')
}

// ----- scenario 17: garbage localStorage config is sanitized to safe defaults -----
{
  const env = makeEnv({ enabled: 'yes', completionSound: 42, approvalVolume: 'loud' })
  let threw = false
  try {
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  } catch (e) { threw = true; console.log(e) }
  ok(!threw, 'garbage config does not crash')
  ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.chime, 'sanitized defaults still play (enabled=true, completionSound=chime)')
}

// ----- scenario 18: settings UI renders Radio.Button groups, volume sliders, switch -----
{
  const env = makeEnv(undefined)
  env.exportsObj.apply(env.ctx)
  let threw = false
  try { env.renderUI() } catch (e) { threw = true; console.log(e) }
  ok(!threw, 'Section renders without throwing')

  const tabs = env.created.filter((n) => n.type === 'button' && n.props.role === 'tab')
  ok(tabs.length === 2 && tabs[0].props['aria-selected'] === 'true' && tabs[1].props['aria-selected'] === 'false', 'renders 主 Agent / 子代理 tabs with the main tab active by default')

  const groups = env.created.filter((n) => n.props && n.props.role === 'radiogroup')
  ok(groups.length === 6, 'main tab renders six Radio.Group rows')
  ok(groups[0].props['data-kind'] === 'completion' && groups[1].props['data-kind'] === 'approval', 'radio groups are named per event kind')

  const radios = env.created.filter((n) => n.type === 'input' && n.props.type === 'radio')
  ok(radios.length === 42, 'renders 42 Radio.Button inputs (6 main events x 7 options)')
  ok(radios.slice(0, 7).map((r) => r.props.value).join(',') === 'ding,chime,bell,complete,success,none,local', 'completion group lists all sound options incl. local')
  ok(radios[1].props.checked === true, 'completion group default chime Radio.Button checked')
  ok(radios[0].props.name === 'dsh-sound-completion' && radios[7].props.name === 'dsh-sound-approval', 'Radio.Button names are scoped per event')

  const ranges = env.created.filter((n) => n.type === 'input' && n.props.type === 'range')
  ok(ranges.length === 6, 'main tab renders six independent volume sliders')
  ok(ranges.every((r) => r.props.min === 0 && r.props.max === 100), 'volume sliders range 0-100')
  ok(ranges.every((r) => r.props.step === 1), 'volume sliders use 1% steps (0.01 precision)')

  const switches = env.created.filter((n) => n.type === 'button' && n.props.role === 'switch')
  ok(switches.length === 1 && switches[0].props['aria-checked'] === 'true', 'renders the enabled switch')

  const audioInputs = env.created.filter((n) => n.type === 'input' && n.props.type === 'file' && n.props.accept === 'audio/*')
  ok(audioInputs.length === 0, 'no local file pickers when all events use builtin sounds')

  const selects = env.created.filter((n) => n.type === 'select')
  ok(selects.length === 0, 'no native select elements')

  const ioButtons = env.created.filter((n) => n.type === 'button' && (n.children[0] === '导出' || n.children[0] === '导入'))
  ok(ioButtons.length === 2, 'export/import remain as two buttons')

  const before = env.getOscCount()
  const bellRadio = radios.find((r) => r.props.value === 'bell')
  bellRadio.props.onClick()
  ok(env.getOscCount() === before + 4 && env.freqs.includes(FREQ.bell), 'clicking a Radio.Button selects and plays it (bell)')
  bellRadio.props.onClick()
  ok(env.getOscCount() === before + 8, 'clicking the selected Radio.Button replays it')
  const noneRadio = radios.find((r) => r.props.value === 'none')
  const beforeNone = env.getOscCount()
  noneRadio.props.onClick()
  ok(env.getOscCount() === beforeNone, 'clicking 静音 plays nothing')
  const chimeRadio = radios.find((r) => r.props.value === 'chime')
  const beforeChime = env.getOscCount()
  chimeRadio.props.onClick()
  ok(env.getOscCount() === beforeChime + 4 && env.freqs.includes(FREQ.chime), 'clicking the already-selected chime replays')
}

// ----- scenario 18b: every product-facing UI key is translated in all supported locales -----
{
  const env = makeEnv(undefined)
  env.exportsObj.apply(env.ctx)
  const productKeys = [
    'sound.ding', 'sound.chime', 'sound.bell', 'sound.complete', 'sound.success', 'sound.none', 'sound.local',
    'event.approval', 'event.question', 'event.planReview', 'event.goalBlocked', 'event.failure',
    'file.embeddedAudio', 'file.noneSelected', 'file.replace', 'file.choose', 'file.clickToPlay',
    'status.configUnavailable', 'section.title', 'tab.mainAgent', 'tab.subagents', 'subagent.ignoreEvents',
    'transfer.title', 'transfer.export', 'transfer.import', 'control.volume', 'control.play',
  ]
  ok(env.languages.get('pt-BR').label === 'Português (Brasil)', 'pt-BR language is registered')
  ok(env.languages.get('es').label === 'Español', 'Spanish language is registered')
  for (const language of ['zh', 'en', 'pt-BR', 'es']) {
    const dictionary = env.dictionaries.get('dsh-sound/' + language)
    ok(!!dictionary && Object.keys(dictionary).length === productKeys.length && productKeys.every((key) => typeof dictionary[key] === 'string' && dictionary[key].length > 0), language + ' has every product-facing translation key')
  }
  env.setLocale('pt-BR')
  env.renderUI()
  ok(env.getSlotReg().registration.opts.label() === 'Notificações sonoras', 'settings section label changes to pt-BR')
  ok(env.created.some((node) => node.type === 'button' && node.props.role === 'tab' && node.children[0] === 'Agente principal'), 'pt-BR main-agent tab renders semantically')
  ok(env.created.some((node) => node.type === 'input' && node.props.type === 'range' && node.props['aria-label'] === 'Volume: Conclusão'), 'pt-BR volume control has a translated accessible name')
  env.setLocale('es')
  env.renderUI()
  ok(env.getSlotReg().registration.opts.label() === 'Notificaciones sonoras', 'settings section label changes to Spanish')
  ok(env.created.some((node) => node.type === 'button' && node.props.role === 'tab' && node.children[0] === 'Agente principal'), 'Spanish main-agent tab renders semantically')
  ok(env.created.some((node) => node.type === 'input' && node.props.type === 'range' && node.props['aria-label'] === 'Volumen: Completado'), 'Spanish volume control has a translated accessible name')
}

// ----- scenario 18c: borrowed locale IDs are matched case-insensitively and survive disposal -----
{
  const borrowedPt = { id: 'PTbr', label: 'Borrowed Portuguese' }
  const borrowedEs = { id: 'ES', label: 'Borrowed Spanish' }
  const env = makeEnv({ _localeLanguages: [['PTbr', borrowedPt], ['ES', borrowedEs]] })
  env.exportsObj.apply(env.ctx)
  ok(env.languages.get('PTbr') === borrowedPt && env.languages.get('ES') === borrowedEs, 'case-insensitive ptBR and es locale guards preserve borrowed registrations')
  ok(env.dictionaries.has('dsh-sound/pt-BR') && env.dictionaries.has('dsh-sound/es'), 'plugin registers dictionaries for borrowed locale IDs')
  env.getEffectDisposer()()
  ok(env.languages.get('PTbr') === borrowedPt && env.languages.get('ES') === borrowedEs, 'disposing plugin does not remove borrowed locale registrations')
}

// ----- scenario 19: local file selection shows a file picker below that event -----
{
  const env = makeEnv({ completionSound: 'audio:a1', failureSound: 'data:audio/mp3;base64,AA' })
  env.exportsObj.apply(env.ctx)
  env.renderUI()
  const radios = env.created.filter((n) => n.type === 'input' && n.props.type === 'radio')
  ok(radios.length === 42, 'Radio.Button groups still render with local values')
  ok(radios[6].props.checked === true, 'completion 本地文件 Radio.Button checked for audio: value')
  const audioInputs = env.created.filter((n) => n.type === 'input' && n.props.type === 'file' && n.props.accept === 'audio/*')
  ok(audioInputs.length === 2, 'file pickers (hidden inputs) appear below events with local file selected (audio: + data:)')
  const fileButtons = env.created.filter((n) => n.type === 'button' && n.props.className === 'dns-notify-btn dns-notify-btn-sm')
  ok(fileButtons.length === 2, 'file rows render 选择/更换 buttons')
  const ioButtons = env.created.filter((n) => n.type === 'button' && (n.children[0] === '导出' || n.children[0] === '导入'))
  ok(ioButtons.length === 2, 'export/import remain beside the file rows')
  const names = env.created.filter((n) => n.type === 'span' && n.props.className === 'dns-notify-file-name')
  ok(names.length === 2, 'file rows show clickable file names')
  names[0].props.onClick()
  names[1].props.onClick()
  ok(env.audioPlays.length === 0, 'file-name clicks do not use the HTMLAudio fallback')
  ok(env.xhrUrls[0] === 'data:audio/mp3;base64,AA' && env.bufferPlays.length === 1, 'clicking the chosen file name decodes and plays it via Web Audio')
}

// ----- scenario 19b: switching builtin <-> local keeps the chosen file -----
{
  const env = makeEnv({ completionSound: 'audio:a1' })
  env.exportsObj.apply(env.ctx)
  env.renderUI()
  const radios = env.created.filter((n) => n.type === 'input' && n.props.type === 'radio')
  const chime = radios.find((r) => r.props.name === 'dsh-sound-completion' && r.props.value === 'chime')
  chime.props.onChange()
  const afterBuiltin = JSON.parse(env.storage.get('dsh-sound:config'))
  ok(afterBuiltin.completionSound === 'chime', 'switching to builtin stores the builtin key')
  ok(afterBuiltin.localFiles && afterBuiltin.localFiles.completion === 'audio:a1', 'chosen local file is stashed, not removed')
  env.renderUI()
  const radios2 = env.created.filter((n) => n.type === 'input' && n.props.type === 'radio')
  ok(radios2[1].props.checked === true, 'chime Radio.Button is selected after leaving local')
  ok(env.created.filter((n) => n.type === 'input' && n.props.type === 'file' && n.props.accept === 'audio/*').length === 0, 'file row hides while builtin is selected')
  const localRadio = radios2.find((r) => r.props.name === 'dsh-sound-completion' && r.props.value === 'local')
  localRadio.props.onChange()
  const afterLocal = JSON.parse(env.storage.get('dsh-sound:config'))
  ok(afterLocal.completionSound === 'audio:a1', 'switching back to 本地文件 restores the same file')
  env.renderUI()
  const radios3 = env.created.filter((n) => n.type === 'input' && n.props.type === 'radio')
  ok(radios3[6].props.checked === true, '本地文件 Radio.Button is selected again')
  ok(env.created.filter((n) => n.type === 'input' && n.props.type === 'file' && n.props.accept === 'audio/*').length === 1, 'file row returns with the stashed file')
}

// ----- scenario 20: legacy 0.2.0 config migrates (defaultSound -> completionSound, old fields ignored) -----
{
  const env = makeEnv({
    enabled: true,
    quietCurrent: false,
    defaultSound: 'bell',
    attentionSound: 'ding',
    volume: 0.5,
    debounceMs: 400,
    workspaces: [{ workspaceId: 'w1', sound: 'ding' }],
    voiceName: '晓晓',
    voiceRate: 1.15,
    attentionPhrase: '需要你的确认',
  })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.freqs[0] === FREQ.bell, 'legacy defaultSound migrates to completionSound (bell)')
  ok(env.gains[0] === 0.26, 'legacy global volume ignored (gain stays at full 0.26)')
}

// ----- scenario 21: legacy voice value degrades to the kind default -----
{
  const env = makeEnv({ defaultSound: 'voice:我做完啦！', failureSound: 'voice' })
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.freqs[0] === FREQ.chime, 'legacy voice: completion degrades to chime')
}

// ----- scenario 22: data URL falls back to Audio element when Web Audio is unavailable -----
{
  const env = makeEnv({ completionSound: 'data:audio/mp3;base64,BB' }, false, false, true)
  env.exportsObj.apply(env.ctx)
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
  env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
  ok(env.audioPlays.length === 1 && env.audioPlays[0] === 'data:audio/mp3;base64,BB', 'no Web Audio: falls back to Audio element playback')
}

// ----- scenario 23: mux event stream drives sounds, dedupes repeats, disposes cleanly -----
;(async () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))
  {
    const env = makeEnv({ planReviewSound: 'complete', questionSound: 'success', goalBlockedSound: 'bell' }, true)
    env.exportsObj.apply(env.ctx)
    env.muxPush({
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    })
    await tick()
    ok(env.freqs.includes(FREQ.chime), 'mux turn/end plays default completion chime')
    const afterTurn = env.getOscCount()
    env.muxPush({
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    })
    await tick()
    ok(env.getOscCount() === afterTurn, 'repeated turn/end within dedupe window is suppressed')

    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] })
    await tick()
    ok(!env.freqs.includes(FREQ.bell), 'mux job running produces no sound')
    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j1', kind: 'bash', label: 'x', status: 'failed', startedAt: 1, finishedAt: 2 }] })
    await tick()
    ok(env.freqs.includes(FREQ.bell), 'mux job failure plays default failure bell')

    env.muxPush({ type: 'approval/requested', sessionId: 's1', approvalId: 'ap1', toolName: 'x' })
    await tick()
    ok(env.freqs.includes(FREQ.ding), 'mux approval/requested plays approval ding')

    env.muxPush({ type: 'session/projection', sessionId: 's1', key: 'goal', value: { phase: 'blocked' } })
    await tick()
    ok(env.freqs.includes(FREQ.bell), 'mux goal projection blocked plays goalBlockedSound (bell)')
    const afterBlocked = env.getOscCount()
    env.muxPush({ type: 'session/projection', sessionId: 's1', key: 'goal', value: { phase: 'blocked' } })
    await tick()
    ok(env.getOscCount() === afterBlocked, 'goal staying blocked does not repeat on mux path')

    env.muxPush({
      type: 'question/requested',
      sessionId: 's1',
      questions: [{ intent: { kind: 'plan-review', approve: '批准' }, detail: { plan: 'p' }, multiSelect: false, options: [{ label: '批准' }, { label: '拒绝' }] }],
    })
    await tick()
    ok(env.freqs.includes(FREQ.complete), 'mux plan-review question plays planReviewSound (complete)')
    env.muxPush({ type: 'question/requested', sessionId: 's1', questions: [{ text: '怎么办？' }] })
    await tick()
    ok(env.freqs.includes(FREQ.success), 'mux normal question plays questionSound (success)')

    const beforeDispose = env.getOscCount()
    env.getEffectDisposer()()
    env.muxPush({ type: 'approval/requested', sessionId: 's1', approvalId: 'ap2', toolName: 'x' })
    await tick()
    ok(env.getOscCount() === beforeDispose, 'disposed watcher stops reacting to frames')
  }
  {
    // 快照路径仍然可用（无 connection 时自动降级）
    const env = makeEnv(undefined)
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
    ok(env.getOscCount() > 0, 'snapshot fallback still works without connection')
  }

  // ----- scenario 23: disposed sessions are pruned (snapshot path) -----
  {
    const env = makeEnv({ enabled: true })
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
    env.drive({ ids: [], byId: {}, current: null, jobsBySession: {} }) // 会话销毁
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} }) // 重新创建（全新 running:false）
    ok(env.getOscCount() === 0, 're-created session starts fresh — no phantom turn-end sound (state pruned)')
  }

  // ----- scenario 24: RpcRequest-wrapped mux envelopes (真实运行时形态：帧在 envelope.payload) -----
  {
    const env = makeEnv({ failureSound: 'complete' }, true)
    env.exportsObj.apply(env.ctx)
    env.muxPush({ type: 'client-request', rpcId: 'r1', method: 'events.mux', payload: { type: 'session/event', sessionId: 's1', event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } } })
    await tick()
    ok(env.freqs.includes(FREQ.chime), 'wrapped turn/end envelope plays completion chime')
    env.muxPush({ type: 'client-request', rpcId: 'r2', method: 'events.mux', payload: { type: 'question/requested', sessionId: 's1', questions: [{ text: 'hi' }] } })
    await tick()
    ok(env.freqs.includes(FREQ.ding), 'wrapped question/requested envelope plays question ding')
    env.muxPush({ type: 'client-request', rpcId: 'r3', method: 'events.mux', payload: { type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j9', kind: 'bash', label: 'x', status: 'running' }] } })
    await tick()
    const before = env.getOscCount()
    env.muxPush({ type: 'client-request', rpcId: 'r4', method: 'events.mux', payload: { type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j9', kind: 'bash', label: 'x', status: 'failed' }] } })
    await tick()
    ok(env.getOscCount() > before && env.freqs.includes(FREQ.complete), 'wrapped job failure envelope plays failure sound')
    env.muxPush({ type: 'client-request', rpcId: 'r5', method: 'events.mux', payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'x' } })
    await tick()
    ok(env.freqs.includes(FREQ.ding), 'wrapped approval/requested envelope plays approval sound')
    env.getEffectDisposer()()
  }

  // ----- scenario 25: mux path prunes disposed sessions and ignores malformed job frames -----
  {
    const env = makeEnv({ failureSound: 'complete' }, true)
    env.exportsObj.apply(env.ctx)
    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] })
    await tick()
    env.setSessionIds([]) // 会话从 sessions.list 消失（销毁）
    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j1', kind: 'bash', label: 'x', status: 'failed', startedAt: 1, finishedAt: 2 }] })
    await tick()
    ok(env.getOscCount() === 0, 'disposed session job transition is pruned — no phantom failure sound')
    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ kind: 'bash', label: 'x', status: 'failed' }, null] })
    await tick()
    ok(env.getOscCount() === 0, 'malformed job frames (missing id / null) are ignored without crash')
    env.getEffectDisposer()()
  }

  // ----- scenario 25: reconnect backoff doubles on failure and resets on healthy frames -----
  {
    const env = makeEnv(undefined, true)
    env.exportsObj.apply(env.ctx)
    env.muxEnd()
    await tick()
    ok(env.pendingTimersMs(800).length === 1, 'reconnect uses base delay 800ms')
    env.fireTimersMs(800)
    env.muxEnd()
    await tick()
    ok(env.pendingTimersMs(1600).length === 1, 'consecutive failures double the delay (1600ms)')
    env.fireTimersMs(1600)
    env.muxPush({
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    })
    await tick()
    env.muxEnd()
    await tick()
    ok(env.pendingTimersMs(800).length === 1, 'healthy frame resets backoff to 800ms')
    env.getEffectDisposer()()
  }

  // ----- scenario 26: cross-tab dedupe — another tab wins the tie-break, this tab stays silent -----
  {
    const env = makeEnv({ completionSound: 'ding' }, false, true)
    const BC = env.getBroadcastClass()
    const other = new BC('dsh-sound')
    let seen = null
    other.onmessage = (ev) => {
      seen = ev.data
      if (seen && seen.t === 'hello') other.postMessage({ t: 'hello-ack' })
      if (seen && seen.t === 'intent') other.postMessage({ t: 'intent', key: seen.key, nonce: 0 })
    }
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
    ok(seen && seen.t === 'intent' && seen.key === 'session:s1', 'play intent broadcast to other tabs')
    ok(env.timers.length === 1 && env.timers[0].ms === 40, 'play deferred 40ms for cross-tab tie-break')
    env.fireTimers()
    ok(env.getOscCount() === 0, 'other tab wins the tie-break; this tab stays silent')
  }

  // ----- scenario 27: single tab still plays after the handshake delay -----
  {
    const env = makeEnv({ completionSound: 'ding' }, false, true)
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
    ok(env.pendingTimersMs(40).length === 0, 'single tab does not defer play for a handshake')
    ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.ding, 'single tab plays immediately')
  }

  // ----- scenario 28: turn/end reason split (completed / error / aborted) -----
  {
    const env = makeEnv({ failureSound: 'complete' }, true)
    env.exportsObj.apply(env.ctx)
    env.muxPush({
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
    })
    await tick()
    ok(env.getOscCount() === 0, 'turn/end aborted is silent')
    env.muxPush({
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'max-tokens' } } },
    })
    await tick()
    ok(env.getOscCount() === 0, 'turn/end max-tokens is silent')
    env.muxPush({
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } },
    })
    await tick()
    ok(env.freqs.includes(FREQ.complete), 'turn/end error plays failure sound')
    env.getEffectDisposer()()
  }

  // ----- scenario 29: killed jobs stay silent (mux + snapshot) -----
  {
    const muxEnv = makeEnv({ completionSound: 'chime' }, true)
    muxEnv.exportsObj.apply(muxEnv.ctx)
    muxEnv.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] })
    await tick()
    muxEnv.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'j1', kind: 'bash', label: 'x', status: 'killed', startedAt: 1, finishedAt: 2 }] })
    await tick()
    ok(muxEnv.getOscCount() === 0, 'mux killed job is silent')
    muxEnv.getEffectDisposer()()

    const snapEnv = makeEnv({ completionSound: 'chime' })
    snapEnv.exportsObj.apply(snapEnv.ctx)
    snapEnv.drive({
      ids: ['s1'], byId: { s1: snapEnv.row({ running: false }) }, current: 's1',
      jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] },
    })
    snapEnv.drive({
      ids: ['s1'], byId: { s1: snapEnv.row({ running: false }) }, current: 's1',
      jobsBySession: { s1: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'killed', startedAt: 1, finishedAt: 2 }] },
    })
    ok(snapEnv.getOscCount() === 0, 'snapshot killed job is silent')
  }

  // ----- scenario 30: mux-open replay of requested frames does not ring -----
  {
    const env = makeEnv({ approvalSound: 'ding' }, true)
    env.exportsObj.apply(env.ctx)
    env.muxPush({ rpcId: 'replay-ap', payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'ap1', toolName: 'x' } })
    await tick()
    ok(env.getOscCount() === 0, 'open-burst replay of approval/requested is silent')
    env.fireTimersMs(0)
    env.muxPush({ rpcId: 'replay-ap', payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'ap1', toolName: 'x' } })
    await tick()
    ok(env.getOscCount() === 0, 'same rpcId after burst still silent (reconnect replay)')
    env.muxPush({ rpcId: 'live-ap', payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'ap2', toolName: 'x' } })
    await tick()
    ok(env.freqs.includes(FREQ.ding), 'new rpcId after burst plays approval sound')
    env.getEffectDisposer()()
  }

  // ----- scenario 31: host/agent-error plays failure -----
  {
    const env = makeEnv({ failureSound: 'complete' }, true)
    env.exportsObj.apply(env.ctx)
    env.hostPush({ rpcId: 'he1', payload: { type: 'host/agent-error', sessionId: 's1', message: 'boom' } })
    await tick()
    ok(env.freqs.includes(FREQ.complete), 'host/agent-error plays failure sound')
    const after = env.getOscCount()
    env.hostPush({ rpcId: 'he2', payload: { type: 'host/agent-error', sessionId: 's1', message: 'again' } })
    await tick()
    ok(env.getOscCount() === after, 'repeat agent-error within dedupe window is suppressed')
    env.getEffectDisposer()()
  }

  // ----- scenario 32: pendingInteraction from the list snapshot wins over frame shape -----
  {
    const env = makeEnv({ planReviewSound: 'complete', questionSound: 'success' }, true)
    env.exportsObj.apply(env.ctx)
    env.fireTimersMs(0)
    env.setSessionIds(['s1'])
    env.drive({
      ids: ['s1'],
      byId: { s1: env.row({ running: false, pendingInteraction: 'plan-review' }) },
      current: 's1',
      jobsBySession: {},
    })
    env.muxPush({
      rpcId: 'q-live',
      payload: { type: 'question/requested', sessionId: 's1', questions: [{ text: '普通提问外形' }] },
    })
    await tick()
    ok(env.freqs[0] === FREQ.complete, 'list pendingInteraction=plan-review overrides a plain question frame')
    env.getEffectDisposer()()
  }

  // ----- scenario 33: unparseable mux frames fall back to snapshot watcher -----
  {
    const env = makeEnv({ completionSound: 'chime' }, true)
    env.exportsObj.apply(env.ctx)
    for (let i = 0; i < 8; i++) env.muxPush({ rpcId: 'bad-' + i })
    await tick()
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: true }) }, current: 's1', jobsBySession: {} })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
    ok(env.freqs.includes(FREQ.chime), 'after mux unwrap failures, snapshot turn-end still plays')
    env.getEffectDisposer()()
  }

  // ----- scenario 34: subagent session turn end is silent by default (snapshot path) -----
  {
    const env = makeEnv(undefined)
    env.exportsObj.apply(env.ctx)
    env.drive({
      ids: ['s1', 's2'],
      byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: true, parentId: 's1', origin: 'subagent' }) },
      current: 's1',
      jobsBySession: {},
    })
    env.drive({
      ids: ['s1', 's2'],
      byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: false, parentId: 's1', origin: 'subagent' }) },
      current: 's1',
      jobsBySession: {},
    })
    ok(env.getOscCount() === 0, 'subagent session turn end is silent by default (snapshot path)')
  }

  // ----- scenario 35: configured subagent completion plays its own sound (snapshot path) -----
  {
    const env = makeEnv({ subagentCompletionSound: 'bell' })
    env.exportsObj.apply(env.ctx)
    env.drive({
      ids: ['s1', 's2'],
      byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: true, origin: 'subagent' }) },
      current: 's1',
      jobsBySession: {},
    })
    env.drive({
      ids: ['s1', 's2'],
      byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: false, origin: 'subagent' }) },
      current: 's1',
      jobsBySession: {},
    })
    ok(env.getOscCount() > 0 && env.freqs[0] === FREQ.bell, 'subagent session turn end plays subagentCompletionSound (snapshot path)')
  }

  // ----- scenario 36: subagent jobs (kind=subagent) route to the subagent channel -----
  {
    const silent = makeEnv({ completionSound: 'chime' })
    silent.exportsObj.apply(silent.ctx)
    silent.drive({ ids: ['s1'], byId: { s1: silent.row({ running: false }) }, current: 's1', jobsBySession: { s1: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'running', startedAt: 1 }] } })
    silent.drive({ ids: ['s1'], byId: { s1: silent.row({ running: false }) }, current: 's1', jobsBySession: { s1: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'completed', startedAt: 1, finishedAt: 2 }] } })
    ok(silent.getOscCount() === 0, 'subagent job completion is silent by default (snapshot path)')

    const env = makeEnv({ completionSound: 'chime', subagentCompletionSound: 'bell', subagentFailureSound: 'complete' })
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: { s1: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'running', startedAt: 1 }] } })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: { s1: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'completed', startedAt: 1, finishedAt: 2 }] } })
    ok(env.freqs.includes(FREQ.bell) && !env.freqs.includes(FREQ.chime), 'subagent job completion plays subagentCompletionSound, not the main completion sound')
    const before = env.getOscCount()
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: { s1: [{ id: 'subagent-2', kind: 'subagent', label: 'y', status: 'running', startedAt: 3 }] } })
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: { s1: [{ id: 'subagent-2', kind: 'subagent', label: 'y', status: 'failed', startedAt: 3, finishedAt: 4 }] } })
    ok(env.getOscCount() > before && env.freqs.includes(FREQ.complete), 'subagent job failure plays subagentFailureSound')
  }

  // ----- scenario 37: ignoreSubagent mutes subagent events even when sounds are configured -----
  {
    const env = makeEnv({ ignoreSubagent: true, subagentCompletionSound: 'bell', subagentFailureSound: 'complete' })
    env.exportsObj.apply(env.ctx)
    env.drive({
      ids: ['s1', 's2'],
      byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: true, origin: 'subagent' }) },
      current: 's1',
      jobsBySession: { s1: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'running', startedAt: 1 }] },
    })
    env.drive({
      ids: ['s1', 's2'],
      byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: false, origin: 'subagent' }) },
      current: 's1',
      jobsBySession: { s1: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'failed', startedAt: 1, finishedAt: 2 }] },
    })
    ok(env.getOscCount() === 0, 'ignoreSubagent mutes both subagent session and job events')
  }

  // ----- scenario 38: mux child session frames route to the subagent channel -----
  {
    const silent = makeEnv(undefined, true)
    silent.exportsObj.apply(silent.ctx)
    silent.drive({ ids: ['s1', 's2'], byId: { s1: silent.row({ running: false }), s2: silent.row({ id: 's2', running: false, origin: 'subagent' }) }, current: 's1', jobsBySession: {} })
    silent.muxPush({ type: 'session/event', sessionId: 's2', event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } })
    await tick()
    ok(silent.getOscCount() === 0, 'mux child session turn/end is silent by default')
    silent.getEffectDisposer()()

    const env = makeEnv({ subagentCompletionSound: 'bell' }, true)
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1', 's2'], byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: false, origin: 'subagent' }) }, current: 's1', jobsBySession: {} })
    env.muxPush({ type: 'session/event', sessionId: 's2', event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } })
    await tick()
    ok(env.freqs.includes(FREQ.bell), 'mux child session turn/end plays subagentCompletionSound')
    env.getEffectDisposer()()
  }

  // ----- scenario 39: mux subagent jobs and child approvals route to the subagent channel -----
  {
    const env = makeEnv({ subagentCompletionSound: 'bell', subagentApprovalSound: 'success' }, true)
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1', 's2'], byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: false, origin: 'subagent' }) }, current: 's1', jobsBySession: {} })
    env.fireTimersMs(0)
    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'running', startedAt: 1 }] })
    await tick()
    env.muxPush({ type: 'session/jobs', sessionId: 's1', jobs: [{ id: 'subagent-1', kind: 'subagent', label: 'x', status: 'completed', startedAt: 1, finishedAt: 2 }] })
    await tick()
    ok(env.freqs.includes(FREQ.bell), 'mux subagent job completion plays subagentCompletionSound')
    env.muxPush({ type: 'approval/requested', sessionId: 's2', approvalId: 'ap9', toolName: 'x' })
    await tick()
    ok(env.freqs.includes(FREQ.success), 'mux child approval plays subagentApprovalSound')
    env.getEffectDisposer()()
  }

  // ----- scenario 40: ignoreSubagent also mutes mux subagent frames -----
  {
    const env = makeEnv({ ignoreSubagent: true, subagentCompletionSound: 'bell', subagentApprovalSound: 'ding' }, true)
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1', 's2'], byId: { s1: env.row({ running: false }), s2: env.row({ id: 's2', running: false, origin: 'subagent' }) }, current: 's1', jobsBySession: {} })
    env.fireTimersMs(0)
    env.muxPush({ type: 'session/event', sessionId: 's2', event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } })
    await tick()
    env.muxPush({ type: 'approval/requested', sessionId: 's2', approvalId: 'ap10', toolName: 'x' })
    await tick()
    ok(env.getOscCount() === 0, 'ignoreSubagent mutes mux subagent frames')
    env.getEffectDisposer()()
  }

  // ----- scenario 41: main session events keep the main channel -----
  {
    const env = makeEnv({ subagentCompletionSound: 'bell' }, true)
    env.exportsObj.apply(env.ctx)
    env.drive({ ids: ['s1'], byId: { s1: env.row({ running: false }) }, current: 's1', jobsBySession: {} })
    env.muxPush({ type: 'session/event', sessionId: 's1', event: { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } })
    await tick()
    ok(env.freqs.includes(FREQ.chime) && !env.freqs.includes(FREQ.bell), 'main session completion keeps the main completion sound')
    env.getEffectDisposer()()
  }

  // ----- scenario 42: settings tabs switch between the main and subagent panels -----
  {
    const env = makeEnv(undefined)
    env.exportsObj.apply(env.ctx)
    env.renderUI()
    const tabs = env.created.filter((n) => n.type === 'button' && n.props.role === 'tab')
    tabs[1].props.onClick()
    env.rerenderUI()
    const groups = env.created.filter((n) => n.props && n.props.role === 'radiogroup')
    ok(groups.length === 6 && groups[0].props['data-kind'] === 'subagent-completion' && groups[5].props['data-kind'] === 'subagent-failure', 'subagent tab renders the six subagent event rows')
    const radios = env.created.filter((n) => n.type === 'input' && n.props.type === 'radio')
    const checked = radios.filter((radio) => radio.props.checked).map((radio) => radio.props.value)
    ok(checked.join(',') === 'none,ding,ding,ding,bell,bell', 'subagent event defaults keep completion silent and alert events audible')
    const switches = env.created.filter((n) => n.type === 'button' && n.props.role === 'switch')
    ok(switches.length === 2 && switches[1].props['aria-checked'] === 'false', 'subagent tab carries the ignore switch, off by default')
    switches[1].props.onClick()
    env.rerenderUI()
    const stored = JSON.parse(env.storage.get('dsh-sound:config'))
    ok(stored.ignoreSubagent === true, 'ignore switch writes ignoreSubagent to the config store')
    const refreshedTabs = env.created.filter((n) => n.type === 'button' && n.props.role === 'tab')
    ok(refreshedTabs[1].props['aria-selected'] === 'true', 'active tab survives a store-driven rerender')
    refreshedTabs[0].props.onClick()
    env.rerenderUI()
    const mainGroups = env.created.filter((n) => n.props && n.props.role === 'radiogroup')
    ok(mainGroups.length === 6 && mainGroups[0].props['data-kind'] === 'completion', 'switching back shows the main event rows again')
  }

  console.log(failures === 0 ? 'ALL CLIENT TESTS PASSED' : failures + ' FAILURES')
  process.exit(failures === 0 ? 0 : 1)
})()
