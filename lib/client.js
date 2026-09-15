/**
 * dsh-sound — Client 半体（0.4.0）
 *
 * 以 window.__ModuleLoader__.load 注册的懒加载 CJS 工厂。浏览器侧职责：
 * 1. 监听连接层事件流（events.mux + events.host）检测事件（事件流不可用或
 *    连续解包失败时降级为快照 diff）：
 *    - 完成：turn/end 且 reason.kind === 'completed'；后台任务 completed
 *    - 失败：turn/end 且 reason.kind === 'error'；host/agent-error；后台任务 failed
 *    - 注意：审批请求、用户提问、计划评审、目标受阻
 *    - 静音：turn/end 的 aborted / blocked / max-tokens / interrupted；任务 killed
 * 2. 事件按来源分主 agent / 子代理（subagent）两个通道：子代理任务
 *    （job.kind === 'subagent'）与子代理会话（列表行 origin/parentId）独立配置
 *    声音与音量，默认全部静音；ignoreSubagent 忽略全部子代理事件。
 * 3. mux 打开时回放的 approval/question requested（刷新恢复）不响；同 rpcId 只响一次。
 * 4. 六类事件完全独立：各自配置声音（内置合成音 / 静音 / 本地文件）与音量（0–100%）；
 * 5. 播放内置合成铃声（Web Audio）或本地音频文件（IndexedDB 存储）；
 * 6. 在设置面板注册「声音通知」区块（含「子代理事件」分区）。
 *
 * 配置持久化：浏览器 localStorage（键 dsh-sound:config）；本地音乐存 IndexedDB（dsh-sound-audio）。
 * 说明：rc.6 的 settings API 白名单（dsh-host-apiproxy WEB_SETTINGS_NAMESPACES）
 * 不会暴露第三方插件注册的命名空间，故客户端不依赖 settingsScope；
 * 宿主端仍注册同名命名空间，待平台提供暴露机制后可直接迁移。
 */
window.__ModuleLoader__.load({
  id: '@ai-galaxy/dsh-sound',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var LOCAL_KEY = 'dsh-sound:config'

    /* ---------------- 样式（一次注入，HMR 重载时去重） ---------------- */
    var CSS = [
      '.dns-notify-page{display:flex;flex-direction:column;max-width:680px;}',
      '.dns-notify-page>:last-child{border-bottom:none;}',
      '.dns-notify-title{flex:1;min-width:0;font-size:14px;font-weight:400;line-height:22px;',
      'color:var(--dsw-alias-label-primary,#333);}',
      '.dns-notify-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);}',
      '.dns-notify-row{display:flex;align-items:center;gap:8px;padding:16px 0;',
      'border-bottom:1px solid var(--dsw-alias-border-l2,#e5e5e5);}',
      '.dns-notify-event{display:flex;flex-direction:column;gap:8px;padding:16px 0;',
      'border-bottom:1px solid var(--dsw-alias-border-l2,#e5e5e5);}',
      '.dns-notify-event>.dns-notify-row{padding:0;border-bottom:none;}',
      '.dns-notify-events.is-disabled{opacity:0.4;pointer-events:none;}',
      '.dns-notify-tabs{display:flex;gap:4px;padding:12px 0 0;',
      'border-bottom:1px solid var(--dsw-alias-border-l2,#e5e5e5);}',
      '.dns-notify-tab{font:inherit;font-size:13px;line-height:20px;cursor:pointer;padding:6px 12px;',
      'border:none;background:none;color:var(--dsw-alias-label-secondary,#666);',
      'border-bottom:2px solid transparent;margin-bottom:-1px;}',
      '.dns-notify-tab:hover{color:var(--dsw-alias-label-primary,#333);}',
      '.dns-notify-tab.is-active{color:var(--dsw-alias-brand-primary,#3b82f6);',
      'border-bottom-color:var(--dsw-alias-brand-primary,#3b82f6);}',
      '.dns-notify-controls{display:flex;align-items:center;gap:12px;flex:none;}',
      '.dns-notify-radio-group{display:inline-flex;flex-wrap:wrap;width:fit-content;',
      'border:1px solid var(--dsw-alias-border-l2,#e5e5e5);border-radius:8px;overflow:hidden;}',
      '.dns-notify-radio-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;',
      'height:28px;padding:0 10px;font-size:12px;line-height:18px;white-space:nowrap;user-select:none;',
      'color:var(--dsw-alias-label-primary,#333);background:var(--dsw-alias-bg-layer-2,#fff);',
      'border-right:1px solid var(--dsw-alias-border-l2,#e5e5e5);cursor:pointer;}',
      '.dns-notify-radio-btn:last-child{border-right:none;}',
      '.dns-notify-radio-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f0f0);}',
      '.dns-notify-radio-btn.is-checked{background:var(--dsw-alias-brand-primary,#3b82f6);',
      'color:var(--dsw-alias-label-primary-foreground,#fff);}',
      '.dns-notify-radio-btn.is-checked:hover{background:var(--dsw-alias-brand-primary,#3b82f6);}',
      '.dns-notify-radio-btn input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;}',
      '.dns-notify-btn{font:inherit;font-size:14px;line-height:22px;cursor:pointer;flex:none;',
      'height:36px;padding:0 14px;color:var(--dsw-alias-label-primary,#333);',
      'background:var(--dsw-alias-bg-module-platform,#f5f6f7);',
      'border:1px solid var(--dsw-alias-border-l2,#e5e5e5);border-radius:18px;}',
      '.dns-notify-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f0f0);}',
      '.dns-notify-btn-sm{height:28px;padding:0 12px;border-radius:14px;font-size:12px;line-height:18px;}',
      '.dns-notify-range{width:220px;flex:none;accent-color:var(--dsw-alias-brand-primary,#3b82f6);}',
      '.dns-notify-pct{width:36px;flex:none;font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums;}',
      '.dns-notify-switch{position:relative;width:36px;height:20px;padding:0;border:none;border-radius:10px;',
      'background:var(--dsw-alias-bg-module-platform,#e5e5e5);cursor:pointer;flex:none;}',
      '.dns-notify-switch.is-on{background:var(--dsw-alias-brand-primary,#3b82f6);}',
      '.dns-notify-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;',
      'border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);}',
      '.dns-notify-switch.is-on .dns-notify-switch-thumb{left:18px;}',
      '.dns-notify-file-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.dns-notify-file-name{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;user-select:none;}',
      '.dns-notify-file-name:hover{color:var(--dsw-alias-label-primary,#333);text-decoration:underline;}',
      '.dns-notify-file-play{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);}',
      '.dns-notify-radio-btn:focus-within,.dns-notify-switch:focus-visible,.dns-notify-btn:focus-visible{',
      'outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px;}',
    ].join('\n')
    var cssTagId = 'dsh-sound/style'
    if (typeof document !== 'undefined') {
      var existingTag = document.querySelector('style[data-plugin-css="' + cssTagId + '"]')
      if (existingTag) {
        existingTag.textContent = CSS
      } else {
        var styleTag = document.createElement('style')
        styleTag.dataset.plugin = 'dsh-sound'
        styleTag.dataset.pluginCss = cssTagId
        styleTag.textContent = CSS
        document.head.appendChild(styleTag)
      }
    }

    /* ---------------- 配置存储（localStorage 后端，兼容 settingsScope 外形） ---------------- */
    var BUILTIN_KEYS = ['ding', 'chime', 'bell', 'complete', 'success', 'none']

    var CONFIG_DEFAULTS = {
      enabled: true,
      quietCurrent: false,
      ignoreSubagent: false,
      completionSound: 'chime',
      approvalSound: 'ding',
      questionSound: 'ding',
      planReviewSound: 'ding',
      goalBlockedSound: 'ding',
      failureSound: 'bell',
      completionVolume: 1,
      approvalVolume: 1,
      questionVolume: 1,
      planReviewVolume: 1,
      goalBlockedVolume: 1,
      failureVolume: 1,
      subagentCompletionSound: 'none',
      subagentApprovalSound: 'ding',
      subagentQuestionSound: 'ding',
      subagentPlanReviewSound: 'ding',
      subagentGoalBlockedSound: 'bell',
      subagentFailureSound: 'bell',
      subagentCompletionVolume: 1,
      subagentApprovalVolume: 1,
      subagentQuestionVolume: 1,
      subagentPlanReviewVolume: 1,
      subagentGoalBlockedVolume: 1,
      subagentFailureVolume: 1,
    }

    // 每类事件的配置字段与默认声音
    var SOUND_FIELD = {
      completion: 'completionSound',
      approval: 'approvalSound',
      question: 'questionSound',
      'plan-review': 'planReviewSound',
      'goal-blocked': 'goalBlockedSound',
      failure: 'failureSound',
    }
    var VOL_FIELD = {
      completion: 'completionVolume',
      approval: 'approvalVolume',
      question: 'questionVolume',
      'plan-review': 'planReviewVolume',
      'goal-blocked': 'goalBlockedVolume',
      failure: 'failureVolume',
    }
    var SOUND_DEFAULT = {
      completion: 'chime',
      approval: 'ding',
      question: 'ding',
      'plan-review': 'ding',
      'goal-blocked': 'ding',
      failure: 'bell',
    }
    var EVENT_KINDS = ['completion', 'approval', 'question', 'plan-review', 'goal-blocked', 'failure']
    var FIELD_KIND = {
      completionSound: 'completion',
      approvalSound: 'approval',
      questionSound: 'question',
      planReviewSound: 'plan-review',
      goalBlockedSound: 'goal-blocked',
      failureSound: 'failure',
    }

    // 子代理来源的同名事件：独立字段、默认静音、localFiles 使用 subagent-<kind> 键
    var SUBAGENT_EVENT_KINDS = ['subagent-completion', 'subagent-approval', 'subagent-question', 'subagent-plan-review', 'subagent-goal-blocked', 'subagent-failure']
    var SUBAGENT_SOUND_FIELD = {
      completion: 'subagentCompletionSound',
      approval: 'subagentApprovalSound',
      question: 'subagentQuestionSound',
      'plan-review': 'subagentPlanReviewSound',
      'goal-blocked': 'subagentGoalBlockedSound',
      failure: 'subagentFailureSound',
    }
    var SUBAGENT_VOL_FIELD = {
      completion: 'subagentCompletionVolume',
      approval: 'subagentApprovalVolume',
      question: 'subagentQuestionVolume',
      'plan-review': 'subagentPlanReviewVolume',
      'goal-blocked': 'subagentGoalBlockedVolume',
      failure: 'subagentFailureVolume',
    }
    var SUBAGENT_FIELD_KIND = {
      subagentCompletionSound: 'subagent-completion',
      subagentApprovalSound: 'subagent-approval',
      subagentQuestionSound: 'subagent-question',
      subagentPlanReviewSound: 'subagent-plan-review',
      subagentGoalBlockedSound: 'subagent-goal-blocked',
      subagentFailureSound: 'subagent-failure',
    }

    function soundFieldFor(kind, isSubagent) {
      return isSubagent ? SUBAGENT_SOUND_FIELD[kind] : SOUND_FIELD[kind]
    }

    function volFieldFor(kind, isSubagent) {
      return isSubagent ? SUBAGENT_VOL_FIELD[kind] : VOL_FIELD[kind]
    }

    /** 子代理事件的 localFiles 键与设置页 data-kind / radio name 后缀。 */
    function subagentKeyFor(kind, isSubagent) {
      return isSubagent ? 'subagent-' + kind : kind
    }

    /** 列表行判定：DSH SessionSummary 的 origin/parentId（兼容 parentSessionId 命名）。 */
    function isSubagentRow(row) {
      return !!(row && (row.origin === 'subagent' || row.parentId !== undefined || row.parentSessionId !== undefined))
    }

    /** 事件帧与任务帧的来源判定：会话行已列出且标记为子代理时视为子代理来源。 */
    function isSubagentSession(ctx, sid) {
      if (!ctx || !ctx.sessions || !ctx.sessions.list || !sid) return false
      try {
        var snap = ctx.sessions.list.getSnapshot()
        var row = snap && snap.byId ? snap.byId[sid] : undefined
        return isSubagentRow(row)
      } catch (err) { return false }
    }

    function isFileSound(v) {
      return typeof v === 'string' && (v.indexOf('audio:') === 0 || v.indexOf('data:') === 0)
    }

    /** 合法声音值：内置键 / 'local'（本地文件待选）/ data URL / IndexedDB 引用。 */
    function validSound(v) {
      if (typeof v !== 'string' || !v) return false
      if (BUILTIN_KEYS.indexOf(v) >= 0) return true
      if (v === 'local') return true
      if (v.indexOf('data:') === 0) return true
      if (v.indexOf('audio:') === 0) return true
      return false
    }

    function sanitize(value) {
      var out = {}
      var f
      out.enabled = CONFIG_DEFAULTS.enabled
      out.quietCurrent = CONFIG_DEFAULTS.quietCurrent
      out.ignoreSubagent = CONFIG_DEFAULTS.ignoreSubagent
      var fields = ['completionSound', 'approvalSound', 'questionSound', 'planReviewSound', 'goalBlockedSound', 'failureSound']
      var vols = ['completionVolume', 'approvalVolume', 'questionVolume', 'planReviewVolume', 'goalBlockedVolume', 'failureVolume']
      var subFields = ['subagentCompletionSound', 'subagentApprovalSound', 'subagentQuestionSound', 'subagentPlanReviewSound', 'subagentGoalBlockedSound', 'subagentFailureSound']
      var subVols = ['subagentCompletionVolume', 'subagentApprovalVolume', 'subagentQuestionVolume', 'subagentPlanReviewVolume', 'subagentGoalBlockedVolume', 'subagentFailureVolume']
      for (f = 0; f < fields.length; f++) out[fields[f]] = CONFIG_DEFAULTS[fields[f]]
      for (f = 0; f < vols.length; f++) out[vols[f]] = CONFIG_DEFAULTS[vols[f]]
      for (f = 0; f < subFields.length; f++) out[subFields[f]] = CONFIG_DEFAULTS[subFields[f]]
      for (f = 0; f < subVols.length; f++) out[subVols[f]] = CONFIG_DEFAULTS[subVols[f]]
      out.localFiles = {}
      if (value && typeof value === 'object') {
        if (typeof value.enabled === 'boolean') out.enabled = value.enabled
        if (typeof value.quietCurrent === 'boolean') out.quietCurrent = value.quietCurrent
        if (typeof value.ignoreSubagent === 'boolean') out.ignoreSubagent = value.ignoreSubagent
        // 旧版字段迁移：defaultSound → completionSound；voice/voice:* 值降级为该类默认音
        var completionValue = value.completionSound !== undefined ? value.completionSound : value.defaultSound
        if (validSound(completionValue)) out.completionSound = completionValue
        for (f = 0; f < fields.length; f++) {
          var fk = fields[f]
          if (fk === 'completionSound') continue
          if (validSound(value[fk])) out[fk] = value[fk]
        }
        for (f = 0; f < subFields.length; f++) {
          if (validSound(value[subFields[f]])) out[subFields[f]] = value[subFields[f]]
        }
        for (f = 0; f < vols.length; f++) {
          var vk = vols[f]
          if (typeof value[vk] === 'number' && value[vk] >= 0 && value[vk] <= 1) out[vk] = value[vk]
        }
        for (f = 0; f < subVols.length; f++) {
          var svk = subVols[f]
          if (typeof value[svk] === 'number' && value[svk] >= 0 && value[svk] <= 1) out[svk] = value[svk]
        }
        if (value.localFiles && typeof value.localFiles === 'object' && !Array.isArray(value.localFiles)) {
          var localKeys = EVENT_KINDS.concat(SUBAGENT_EVENT_KINDS)
          for (f = 0; f < localKeys.length; f++) {
            var ek = localKeys[f]
            if (isFileSound(value.localFiles[ek])) out.localFiles[ek] = value.localFiles[ek]
          }
        }
        for (f = 0; f < fields.length; f++) {
          if (isFileSound(out[fields[f]])) out.localFiles[FIELD_KIND[fields[f]]] = out[fields[f]]
        }
        for (f = 0; f < subFields.length; f++) {
          if (isFileSound(out[subFields[f]])) out.localFiles[SUBAGENT_FIELD_KIND[subFields[f]]] = out[subFields[f]]
        }
        // 旧版 workspaces / debounceMs / volume / voice* / attention* 等字段一律忽略
      }
      return out
    }

    function readLocal() {
      try {
        var raw = window.localStorage.getItem(LOCAL_KEY)
        return raw ? JSON.parse(raw) : null
      } catch (err) { return null }
    }

    function createConfigStore() {
      var snapshot = { status: 'ready', value: sanitize(readLocal()) }
      var listeners = []
      function commit(next) {
        snapshot = { status: 'ready', value: next }
        try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next)) } catch (err) { /* 隐私模式等：仅内存生效 */ }
        var list = listeners.slice()
        for (var i = 0; i < list.length; i++) list[i]()
      }
      return {
        getSnapshot: function () { return snapshot },
        subscribe: function (fn) {
          listeners.push(fn)
          return function () {
            var i = listeners.indexOf(fn)
            if (i >= 0) listeners.splice(i, 1)
          }
        },
        set: function (field, value) {
          var next = {}
          next[field] = value
          return this.patch(next)
        },
        patch: function (partial) {
          commit(sanitize(Object.assign({}, snapshot.value, partial)))
          return Promise.resolve()
        },
        replace: function (next) { commit(sanitize(next)) },
      }
    }

    /* ---------------- 音频引擎 ---------------- */
    var audioCtx = null
    var lastPlayed = new Map()

    function ensureContext() {
      if (audioCtx === null) {
        var AC = window.AudioContext || window.webkitAudioContext
        audioCtx = AC ? new AC() : undefined
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        var p = audioCtx.resume()
        if (p && p.catch) p.catch(function () {})
      }
      return audioCtx
    }

    function tone(ctx, freq, delay, dur, type, gain, slideTo, vol) {
      var volume = vol === undefined ? 1 : vol
      var t0 = ctx.currentTime + delay
      var osc = ctx.createOscillator()
      var g = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t0)
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(gain * volume, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.05)
    }

    /** 带泛音分量的音：partials = [[倍频, 时长比, 波形, 增益比], ...] */
    function richTone(ctx, freq, delay, dur, type, gain, partials, vol) {
      tone(ctx, freq, delay, dur, type, gain, undefined, vol)
      if (partials) {
        for (var i = 0; i < partials.length; i++) {
          var p = partials[i]
          tone(ctx, freq * p[0], delay, dur * p[1], p[2] || 'sine', gain * p[3], undefined, vol)
        }
      }
    }

    function playBuiltin(key, vol) {
      var ctx = ensureContext()
      if (!ctx) return
      if (key === 'ding') {
        // 叮-咚：门铃式双音
        richTone(ctx, 698.46, 0.02, 0.5, 'sine', 0.3, [[2, 0.8, 'sine', 0.35], [3.01, 0.5, 'sine', 0.12]], vol)
        richTone(ctx, 587.33, 0.28, 0.7, 'sine', 0.26, [[2, 0.8, 'sine', 0.3]], vol)
      } else if (key === 'chime') {
        // 风铃：A5 → E6 悠长
        richTone(ctx, 880, 0.02, 0.5, 'sine', 0.22, [[2.76, 0.6, 'sine', 0.18]], vol)
        richTone(ctx, 1318.5, 0.24, 1.1, 'sine', 0.2, [[2, 0.5, 'sine', 0.1]], vol)
      } else if (key === 'bell') {
        // 钟铃：非谐泛音
        richTone(ctx, 493.88, 0.02, 1.6, 'sine', 0.26, [[2, 0.85, 'sine', 0.3], [2.4, 0.6, 'sine', 0.18], [3.02, 0.45, 'sine', 0.1]], vol)
      } else if (key === 'complete') {
        // 完成：C-E-G-C 上行琶音
        richTone(ctx, 523.25, 0.02, 0.28, 'triangle', 0.22, [[2, 0.7, 'sine', 0.25]], vol)
        richTone(ctx, 659.25, 0.18, 0.28, 'triangle', 0.22, [[2, 0.7, 'sine', 0.25]], vol)
        richTone(ctx, 783.99, 0.34, 0.28, 'triangle', 0.22, [[2, 0.7, 'sine', 0.25]], vol)
        richTone(ctx, 1046.5, 0.5, 0.8, 'triangle', 0.22, [[2, 0.6, 'sine', 0.25]], vol)
      } else if (key === 'success') {
        // 成功：明快 G5 → C6 双音
        richTone(ctx, 783.99, 0.02, 0.2, 'sine', 0.2, [[2, 0.7, 'sine', 0.3]], vol)
        richTone(ctx, 1046.5, 0.16, 0.75, 'sine', 0.2, [[2, 0.6, 'sine', 0.25]], vol)
      } else {
        tone(ctx, 880, 0.02, 0.4, 'sine', 0.2, undefined, vol)
      }
    }

    /* ---------------- 本地文件播放（Web Audio 解码，绕开 HTMLAudioElement 自动播放限制） ---------------- */
    var decodedCache = new Map() // audio id -> AudioBuffer（同一文件不重复解码）

    /** 把已解码的 AudioBuffer 播进当前 AudioContext（音量经 GainNode）。 */
    function playBuffer(ctx, decoded, vol) {
      try {
        var src = ctx.createBufferSource()
        src.buffer = decoded
        var g = ctx.createGain()
        g.gain.value = (typeof vol === 'number' && vol >= 0 && vol <= 1) ? vol : 1
        src.connect(g)
        g.connect(ctx.destination)
        src.start()
      } catch (err) { /* 播放失败静默 */ }
    }

    /** 播放 data URL 音频：优先 XHR + decodeAudioData 走 Web Audio（无需每次手势）；失败回退 Audio 元素。 */
    function playCustom(dataUrl, vol) {
      var ctx = ensureContext()
      if (!ctx || typeof ctx.decodeAudioData !== 'function') { fallbackAudio(dataUrl, vol); return }
      var xhr = null
      try {
        xhr = new window.XMLHttpRequest()
        xhr.open('GET', dataUrl, true)
        xhr.responseType = 'arraybuffer'
        xhr.onload = function () {
          if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
            ctx.decodeAudioData(xhr.response, function (decoded) {
              playBuffer(ctx, decoded, vol)
            }, function () { fallbackAudio(dataUrl, vol) })
          } else {
            fallbackAudio(dataUrl, vol)
          }
        }
        xhr.onerror = function () { fallbackAudio(dataUrl, vol) }
        xhr.send()
      } catch (err) { fallbackAudio(dataUrl, vol) }
    }

    /** 兜底：HTMLAudioElement 播放（可能被自动播放策略拦截）。 */
    function fallbackAudio(dataUrl, vol) {
      try {
        var audio = new window.Audio(dataUrl)
        if (typeof vol === 'number' && vol >= 0 && vol <= 1) audio.volume = vol
        var p = audio.play()
        if (p && p.catch) p.catch(function () {})
      } catch (err) { /* 自动播放被浏览器拦截时静默 */ }
    }

    /* ---------------- IndexedDB 音频库（本地文件，避开 localStorage 配额） ---------------- */
    var audioCache = new Map() // audio id -> data URL
    var audioDbPromise = null

    function audioStore() {
      if (audioDbPromise === null) audioDbPromise = openAudioDb()
      return audioDbPromise
    }

    function openAudioDb() {
      try {
        if (typeof window.indexedDB === 'undefined') return Promise.resolve(null)
        return new Promise(function (resolve) {
          var req = window.indexedDB.open('dsh-sound-audio', 1)
          req.onupgradeneeded = function () {
            var db = req.result
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files')
          }
          req.onsuccess = function () { resolve(req.result) }
          req.onerror = function () { resolve(null) }
          req.onblocked = function () { resolve(null) }
        })
      } catch (err) { return Promise.resolve(null) }
    }

    /** 记录兼容：0.3.0 起存 { blob, name }；旧数据为裸 Blob。 */
    function blobOf(record) {
      return record && record.blob !== undefined ? record.blob : record
    }

    /** 保存一个音频文件到 IndexedDB，返回 `audio:<id>` 引用；存储不可用时返回 data URL。 */
    function storeUploaded(file) {
      if (typeof window.indexedDB !== 'undefined') {
        return saveAudio(file).then(function (id) {
          return id ? 'audio:' + id : readAsDataUrl(file)
        })
      }
      return readAsDataUrl(file)
    }

    function saveAudio(file) {
      return audioStore().then(function (db) {
        if (!db) return null
        var id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        return new Promise(function (resolve) {
          var tx = db.transaction('files', 'readwrite')
          tx.objectStore('files').put({ blob: file, name: (file && typeof file.name === 'string' && file.name) || '' }, id)
          tx.oncomplete = function () { resolve(id) }
          tx.onerror = function () { resolve(null) }
          tx.onabort = function () { resolve(null) }
        })
      })
    }

    function loadAudio(id) {
      if (audioCache.has(id)) return Promise.resolve(audioCache.get(id))
      return audioStore().then(function (db) {
        if (!db) return null
        return new Promise(function (resolve) {
          var req = db.transaction('files', 'readonly').objectStore('files').get(id)
          req.onsuccess = function () {
            var blob = blobOf(req.result)
            if (!blob) { resolve(null); return }
            var reader = new window.FileReader()
            reader.onload = function () {
              var url = String(reader.result)
              audioCache.set(id, url)
              resolve(url)
            }
            reader.onerror = function () { resolve(null) }
            reader.readAsDataURL(blob)
          }
          req.onerror = function () { resolve(null) }
        })
      })
    }

    /** 读取音频文件的原文件名（设置面板展示用）。 */
    function loadAudioMeta(id) {
      return audioStore().then(function (db) {
        if (!db) return ''
        return new Promise(function (resolve) {
          var req = db.transaction('files', 'readonly').objectStore('files').get(id)
          req.onsuccess = function () {
            var record = req.result
            resolve(record && typeof record.name === 'string' ? record.name : '')
          }
          req.onerror = function () { resolve('') }
        })
      })
    }

    function removeAudio(id) {
      audioCache.delete(id)
      decodedCache.delete(id)
      return audioStore().then(function (db) {
        if (!db) return
        try {
          db.transaction('files', 'readwrite').objectStore('files').delete(id)
        } catch (err) { /* 存储不可用时忽略 */ }
      })
    }

    function readAsDataUrl(file) {
      return new Promise(function (resolve) {
        var reader = new window.FileReader()
        reader.onload = function () { resolve(String(reader.result)) }
        reader.onerror = function () { resolve('') }
        reader.readAsDataURL(file)
      })
    }

    /** 读取 IndexedDB 中的原始音频 Blob。 */
    function loadAudioBlob(id) {
      return audioStore().then(function (db) {
        if (!db) return null
        return new Promise(function (resolve) {
          var req = db.transaction('files', 'readonly').objectStore('files').get(id)
          req.onsuccess = function () { resolve(blobOf(req.result) || null) }
          req.onerror = function () { resolve(null) }
        })
      })
    }

    /**
     * 播放 IndexedDB 音频引用：Web Audio decodeAudioData（与合成音共用已解锁的
     * AudioContext，事件触发也能响，不受 HTMLAudioElement 自动播放策略限制）。
     */
    function playAudioRef(id, vol) {
      var ctx = ensureContext()
      if (!ctx || typeof ctx.decodeAudioData !== 'function' || typeof window.FileReader !== 'function') {
        // 无 Web Audio 解码能力：回退 data URL + Audio 元素
        loadAudio(id).then(function (url) { if (url) fallbackAudio(url, vol) })
        return
      }
      if (decodedCache.has(id)) { playBuffer(ctx, decodedCache.get(id), vol); return }
      loadAudioBlob(id).then(function (blob) {
        if (!blob) return
        var reader = new window.FileReader()
        reader.onload = function () {
          ctx.decodeAudioData(reader.result, function (decoded) {
            decodedCache.set(id, decoded)
            playBuffer(ctx, decoded, vol)
          }, function () { /* 解码失败静默 */ })
        }
        reader.onerror = function () {}
        reader.readAsArrayBuffer(blob)
      })
    }

    /* ---------------- 播放（固定同源去抖，无合并窗口） ---------------- */
    var DEDUPE_MS = 400 // 同一来源（同一次回合/任务/审批）短时间去抖，防重复帧；不再提供合并窗口
    var PRUNE_AFTER = 300000 // 5 分钟：去抖表只保留近期 key，防 key 无限增长
    var REOPEN_BASE = 800 // mux 重连基础延迟
    var REOPEN_MAX = 30000 // mux 重连最大延迟（指数退避封顶）
    var BAD_FRAME_FALLBACK = 8 // 连续解不出 type 的帧数，超过则放弃 mux 改走快照
    var playCount = 0

    /* ---------------- 多标签页去重（BroadcastChannel） ---------------- */
    var crossTab = null
    var peerSeen = false // 只有确认存在另一标签时才做 40ms 握手
    var crossTabPending = new Map() // sourceKey -> { nonce, timer }
    try {
      if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
        crossTab = new window.BroadcastChannel('dsh-sound')
        crossTab.onmessage = function (ev) {
          var msg = ev && ev.data
          if (!msg || typeof msg !== 'object') return
          if (msg.t === 'hello') {
            peerSeen = true
            try { crossTab.postMessage({ t: 'hello-ack' }) } catch (err) { /* 频道已关 */ }
            return
          }
          if (msg.t === 'hello-ack') {
            peerSeen = true
            return
          }
          if (msg.t !== 'intent' || typeof msg.key !== 'string') return
          peerSeen = true
          var mine = crossTabPending.get(msg.key)
          // nonce 较大的一方让位：两个标签同时收到对方意图时，恰有一个播放
          if (mine && mine.nonce > msg.nonce) {
            cancelSchedule(mine.timer)
            crossTabPending.delete(msg.key)
          }
        }
        try { crossTab.postMessage({ t: 'hello' }) } catch (err) { /* 频道已关 */ }
      }
    } catch (err) { crossTab = null }

    function pruneLastPlayed() {
      var cutoff = Date.now() - PRUNE_AFTER
      lastPlayed.forEach(function (t, k) { if (t < cutoff) lastPlayed.delete(k) })
    }

    /**
     * 播放一个声音值：
     *   'data:…'        内嵌音频（data URL）
     *   'audio:<id>'    IndexedDB 音频库引用
     *   'local'         本地文件待选（无文件，不播放）
     *   'none'          静音
     *   其余为内置合成音。
     * sourceKey 用于同一来源的去抖；未提供时（试听）不限制。
     */
    function playSound(key, sourceKey, cfg, vol) {
      if (!key || key === 'none' || key === 'local') return
      var volume = typeof vol === 'number' && vol >= 0 && vol <= 1 ? vol : 1
      if (sourceKey) {
        var now = Date.now()
        var last = lastPlayed.get(sourceKey)
        if (last !== undefined && now - last < DEDUPE_MS) return
        lastPlayed.set(sourceKey, now)
      }
      playCount++
      if (playCount % 32 === 0) pruneLastPlayed()
      if (key.indexOf('data:') === 0) playCustom(key, volume)
      else if (key.indexOf('audio:') === 0) playAudioRef(key.slice(6), volume)
      else playBuiltin(key, volume)
    }

    /** 试听 / 上传后立即播放：跳过同源去抖。 */
    function playImmediate(key, cfg, vol) {
      playSound(key, undefined, cfg, vol)
    }

    /** 事件播放入口：按事件类型与来源（主 agent / 子代理）解析声音与音量。 */
    function soundFor(cfg, kind, isSubagent) {
      var field = soundFieldFor(kind, isSubagent)
      var value = field && cfg ? cfg[field] : undefined
      if (!value) return isSubagent ? 'none' : (SOUND_DEFAULT[kind] || 'ding')
      return value
    }

    function volFor(cfg, kind, isSubagent) {
      var field = volFieldFor(kind, isSubagent)
      var v = field && cfg ? cfg[field] : undefined
      return typeof v === 'number' ? v : 1
    }

    function playFor(cfg, kind, sourceKey, isSubagent) {
      if (!cfg || cfg.enabled === false) return
      if (isSubagent && cfg.ignoreSubagent === true) return
      var sound = soundFor(cfg, kind, isSubagent)
      if (!sound || sound === 'none' || sound === 'local') return
      if (crossTab && sourceKey) {
        playWithCrossTabDedupe(sound, sourceKey, cfg, volFor(cfg, kind, isSubagent))
        return
      }
      playSound(sound, sourceKey, cfg, volFor(cfg, kind, isSubagent))
    }

    /**
     * 多标签页去重：已确认有同伴时先广播「播放意图」，40ms 内同 key 的另一标签
     * 抢先则让位（随机 nonce 决出唯一播放者）。单标签页直接播放，不做握手。
     */
    function playWithCrossTabDedupe(key, sourceKey, cfg, vol) {
      if (!peerSeen) {
        try { crossTab.postMessage({ t: 'intent', key: sourceKey, nonce: Math.random() }) } catch (err) { /* 频道已关 */ }
        playSound(key, sourceKey, cfg, vol)
        return
      }
      var nonce = Math.random()
      var timer = schedule(function () {
        crossTabPending.delete(sourceKey)
        playSound(key, sourceKey, cfg, vol)
      }, 40)
      crossTabPending.set(sourceKey, { nonce: nonce, timer: timer })
      try { crossTab.postMessage({ t: 'intent', key: sourceKey, nonce: nonce }) } catch (err) { /* 频道已关 */ }
    }

    function configOf(snapshot) {
      if (!snapshot || snapshot.status !== 'ready' || !snapshot.value) return undefined
      return snapshot.value
    }

    /**
     * 与 SessionManager.questionInteractionStatus 一致的单问题计划评审分类
     * （多问题 / 多选 / 无匹配选项按普通提问处理）。
     */
    function questionKind(questions) {
      if (!Array.isArray(questions) || questions.length !== 1) return 'question'
      var q = questions[0]
      var intent = q && q.intent
      if (!intent || intent.kind !== 'plan-review' || q.detail === undefined) return 'question'
      if (q.multiSelect === true) return 'question'
      var options = q.options || []
      if (options.length > 2) return 'question'
      for (var i = 0; i < options.length; i++) {
        if (options[i] && options[i].label === intent.approve) return 'plan-review'
      }
      return 'question'
    }

    /** 优先用列表快照上 manager 已分好的 pendingInteraction，避免两套规则漂移。 */
    function resolveQuestionKind(ctx, sid, questions) {
      try {
        var snap = ctx.sessions.list.getSnapshot()
        var row = snap && snap.byId && sid ? snap.byId[sid] : undefined
        var pi = row && row.pendingInteraction
        if (pi === 'plan-review' || pi === 'question') return pi
      } catch (err) { /* 快照不可用时走帧内分类 */ }
      return questionKind(questions)
    }

    /** 真实运行时 mux/host 产出 RpcRequest 信封（帧在 envelope.payload）；兼容旧式裸帧。 */
    function unwrapFrame(envelope) {
      if (!envelope || typeof envelope !== 'object') return null
      var frame = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : envelope
      if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') return null
      return frame
    }

    function turnEndKind(ev) {
      if (!ev || ev.type !== 'turn/end') return ''
      var reason = ev.data && ev.data.reason
      return reason && typeof reason.kind === 'string' ? reason.kind : ''
    }

    function playJobTerminal(cfg, sid, job, prev, skipCurrent, isSubagent) {
      var terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'killed'
      if (!((prev === 'running' || prev === 'stopping') && terminal)) return
      if (job.status === 'failed') playFor(cfg, 'failure', 'job:' + sid + ':' + job.id, isSubagent)
      else if (job.status === 'killed') return
      else if (!skipCurrent) playFor(cfg, 'completion', 'job:' + sid + ':' + job.id, isSubagent)
    }

    /** 事件流监听（connection.events.mux）为主路径：帧级精确检测，任务创建即完成等场景不漏响。 */
    function startMuxWatcher(ctx, store, onGiveUp) {
      var disposed = false
      var loopAbort = null
      var reopenTimer = null
      var burstTimer = null
      var prevJobStatus = new Map()
      var prevGoalPhase = new Map()
      var seenRpcIds = new Set() // 页生命周期：刷新恢复回放的 requested 与重连同 id 不响
      var openBurst = false // 本轮流打开后、首批握手帧尚未结束
      var badFrames = 0
      var reopenDelay = REOPEN_BASE // 指数退避：成功收到帧即复位

      function skipCurrentSession(cfg, sid) {
        if (!cfg || cfg.quietCurrent !== true) return false
        try {
          var snap = ctx.sessions.list.getSnapshot()
          return snap.current === sid
        } catch (err) { return false }
      }

      /** 清理已销毁会话的状态表（防 session key 无限增长）。 */
      function pruneDisposed() {
        var ids = null
        try {
          var snap = ctx.sessions.list.getSnapshot()
          ids = snap ? snap.ids : null
        } catch (err) { ids = null }
        if (!Array.isArray(ids)) return
        var active = {}
        for (var i = 0; i < ids.length; i++) active[ids[i]] = true
        prevGoalPhase.forEach(function (phase, sid) { if (!active[sid]) prevGoalPhase.delete(sid) })
        prevJobStatus.forEach(function (status, key) {
          var sep = key.indexOf(':')
          if (sep >= 0 && !active[key.slice(0, sep)]) prevJobStatus.delete(key)
        })
      }

      function noteRequestId(envelope) {
        var rid = envelope && envelope.rpcId != null ? String(envelope.rpcId) : ''
        if (!rid) return { seen: false, id: '' }
        if (seenRpcIds.has(rid)) return { seen: true, id: rid }
        seenRpcIds.add(rid)
        return { seen: false, id: rid }
      }

      function handleJobs(cfg, sid, jobs) {
        var seen = {}
        for (var i = 0; i < jobs.length; i++) {
          var job = jobs[i]
          if (!job || !job.id) continue
          var key = sid + ':' + job.id
          seen[key] = true
          var prev = prevJobStatus.get(key)
          var isSub = job.kind === 'subagent' || isSubagentSession(ctx, sid)
          playJobTerminal(cfg, sid, job, prev, skipCurrentSession(cfg, sid), isSub)
          prevJobStatus.set(key, job.status)
        }
        prevJobStatus.forEach(function (st, k) {
          if (k.indexOf(sid + ':') === 0 && !seen[k]) prevJobStatus.delete(k)
        })
      }

      function handleFrame(envelope) {
        var frame = unwrapFrame(envelope)
        if (frame === null) {
          badFrames++
          if (badFrames >= BAD_FRAME_FALLBACK && typeof onGiveUp === 'function') {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('dsh-sound: mux frames have no type after unwrap; falling back to session snapshots')
            }
            onGiveUp()
          }
          return
        }
        badFrames = 0
        reopenDelay = REOPEN_BASE
        var cfg = configOf(store.getSnapshot())
        if (!cfg) return
        pruneDisposed()
        var sid = frame.sessionId

        if (frame.type === 'session/subscribed' || frame.type === 'session/queue') {
          return
        }
        if (frame.type === 'approval/resolved' || frame.type === 'question/resolved') {
          openBurst = false
          if (frame.type === 'question/resolved' && frame.questionRpcId != null) {
            seenRpcIds.delete(String(frame.questionRpcId))
          }
          return
        }
        if (frame.type === 'approval/requested' || frame.type === 'question/requested') {
          var noted = noteRequestId(envelope)
          if (noted.seen || openBurst) return
          var isSub = isSubagentSession(ctx, sid)
          if (frame.type === 'approval/requested') {
            playFor(cfg, 'approval', 'pending:' + sid + ':approval', isSub)
            return
          }
          var kind = resolveQuestionKind(ctx, sid, frame.questions)
          playFor(cfg, kind, 'pending:' + sid + ':' + kind, isSub)
          return
        }
        if (frame.type === 'session/jobs') {
          handleJobs(cfg, sid, frame.jobs || [])
          return
        }

        openBurst = false
        if (frame.type === 'session/event') {
          var ev = frame.event
          var endKind = turnEndKind(ev)
          var isSubEvent = isSubagentSession(ctx, sid)
          if (endKind === 'completed' && !skipCurrentSession(cfg, sid)) {
            playFor(cfg, 'completion', 'session:' + sid, isSubEvent)
          } else if (endKind === 'error') {
            playFor(cfg, 'failure', 'session:' + sid + ':failure', isSubEvent)
          }
        } else if (frame.type === 'session/projection') {
          if (frame.key === 'goal' && frame.value && typeof frame.value === 'object' && typeof frame.value.phase === 'string') {
            var phase = frame.value.phase
            var prev = prevGoalPhase.get(sid)
            if (phase === 'blocked' && prev !== 'blocked') {
              playFor(cfg, 'goal-blocked', 'goal:' + sid, isSubagentSession(ctx, sid))
            }
            prevGoalPhase.set(sid, phase)
          }
        }
      }

      function beginBurst() {
        openBurst = true
        if (burstTimer !== null) cancelSchedule(burstTimer)
        burstTimer = schedule(function () {
          burstTimer = null
          openBurst = false
        }, 0)
      }

      function runLoop() {
        if (disposed) return
        var ac = new AbortController()
        loopAbort = ac
        beginBurst()
        var iterable
        try {
          iterable = ctx.connection.api.events.mux({}, ac.signal)
        } catch (err) { scheduleReopen(); return }
        if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') { scheduleReopen(); return }
        ;(async function () {
          try {
            for await (var frame of iterable) {
              if (disposed) break
              handleFrame(frame)
            }
          } catch (err) { /* 流中断：连接重连或插件卸载，走重开逻辑 */ }
          scheduleReopen()
        })()
      }

      function scheduleReopen() {
        if (disposed) return
        if (loopAbort) { try { loopAbort.abort() } catch (e) {} loopAbort = null }
        var delay = reopenDelay
        reopenDelay = Math.min(reopenDelay * 2, REOPEN_MAX)
        reopenTimer = schedule(function () { runLoop() }, delay)
      }

      runLoop()
      return function () {
        disposed = true
        if (reopenTimer !== null) cancelSchedule(reopenTimer)
        if (burstTimer !== null) cancelSchedule(burstTimer)
        if (loopAbort) { try { loopAbort.abort() } catch (e) {} }
      }
    }

    /** events.host：无 turn 位置的 agent 失败（mux 没有对应帧）。 */
    function startHostWatcher(ctx, store) {
      var disposed = false
      var loopAbort = null
      var reopenTimer = null
      var reopenDelay = REOPEN_BASE

      function handleEnvelope(envelope) {
        var frame = unwrapFrame(envelope)
        if (frame === null) return
        reopenDelay = REOPEN_BASE
        var cfg = configOf(store.getSnapshot())
        if (!cfg) return
        if (frame.type === 'host/agent-error' && frame.sessionId) {
          playFor(cfg, 'failure', 'session:' + frame.sessionId + ':failure', isSubagentSession(ctx, frame.sessionId))
        }
      }

      function runLoop() {
        if (disposed) return
        var host = ctx.connection && ctx.connection.api && ctx.connection.api.events
          ? ctx.connection.api.events.host
          : undefined
        if (typeof host !== 'function') return
        var ac = new AbortController()
        loopAbort = ac
        var iterable
        try {
          iterable = host({}, ac.signal)
        } catch (err) { scheduleReopen(); return }
        if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') { scheduleReopen(); return }
        ;(async function () {
          try {
            for await (var frame of iterable) {
              if (disposed) break
              handleEnvelope(frame)
            }
          } catch (err) { /* 流中断：走重开 */ }
          scheduleReopen()
        })()
      }

      function scheduleReopen() {
        if (disposed) return
        if (loopAbort) { try { loopAbort.abort() } catch (e) {} loopAbort = null }
        var delay = reopenDelay
        reopenDelay = Math.min(reopenDelay * 2, REOPEN_MAX)
        reopenTimer = schedule(function () { runLoop() }, delay)
      }

      runLoop()
      return function () {
        disposed = true
        if (reopenTimer !== null) cancelSchedule(reopenTimer)
        if (loopAbort) { try { loopAbort.abort() } catch (e) {} }
      }
    }

    /** 快照 diff 兜底路径（无 connection 服务 / 旧运行时 / 测试环境）。 */
    function startSnapshotWatcher(ctx, store) {
      var sessionsList = ctx.sessions.list
      var prevRunning = new Map()
      var prevJobStatus = new Map()
      var prevPending = new Map()
      var prevGoalPhase = new Map()

      function check() {
        var snap = sessionsList.getSnapshot()
        if (!snap || !snap.byId) return
        var cfg = configOf(store.getSnapshot())
        if (!cfg) return
        var quietCurrent = cfg.quietCurrent === true
        var byId = snap.byId
        var ids = snap.ids || []

        for (var i = 0; i < ids.length; i++) {
          var id = ids[i]
          var row = byId[id]
          if (!row) continue
          var rowSub = isSubagentRow(row)

          // 会话回合结束：running true -> false（完成铃声，尊重 quietCurrent）
          var was = prevRunning.get(id)
          if (was === true && row.running === false && !(quietCurrent && snap.current === id)) {
            playFor(cfg, 'completion', 'session:' + id, rowSub)
          }
          prevRunning.set(id, row.running === true)

          // 需要人介入：pendingInteraction 出现（approval / question / plan-review）
          var pi = row.pendingInteraction
          var prevPi = prevPending.get(id)
          if (pi !== undefined && pi !== prevPi) {
            var kind = SOUND_FIELD[pi] ? pi : 'question'
            playFor(cfg, kind, 'pending:' + id + ':' + pi, rowSub)
          }
          prevPending.set(id, pi)

          // 目标受阻：goal 投影进入 blocked
          var pv = row.projectionValues
          var goal = pv && typeof pv === 'object' ? pv.goal : undefined
          var phase = goal && typeof goal === 'object' ? goal.phase : undefined
          var prevPhase = prevGoalPhase.get(id)
          if (phase === 'blocked' && prevPhase !== 'blocked') {
            playFor(cfg, 'goal-blocked', 'goal:' + id, rowSub)
          }
          prevGoalPhase.set(id, phase)
        }

        // 后台任务结束：failed → 失败音；其余终态 → 完成铃声（尊重 quietCurrent）
        var jobsBy = snap.jobsBySession || {}
        for (var sid in jobsBy) {
          if (!Object.prototype.hasOwnProperty.call(jobsBy, sid)) continue
          var jobs = jobsBy[sid] || []
          var subagentSession = isSubagentRow(byId[sid])
          for (var j = 0; j < jobs.length; j++) {
            var job = jobs[j]
            if (!job || !job.id) continue // 畸形帧防御
            var key = sid + ':' + job.id
            var prev = prevJobStatus.get(key)
            var terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'killed'
            var isSub = job.kind === 'subagent' || subagentSession
            if ((prev === 'running' || prev === 'stopping') && terminal) {
              if (job.status === 'failed') {
                playFor(cfg, 'failure', 'job:' + key, isSub)
              } else if (job.status === 'killed') {
                /* 用户杀掉的任务不响完成音 */
              } else if (!(quietCurrent && snap.current === sid)) {
                playFor(cfg, 'completion', 'job:' + key, isSub)
              }
            }
            prevJobStatus.set(key, job.status)
          }
        }

        // 清理已销毁会话的状态表（防 session key 无限增长）
        var activeIds = {}
        for (var a = 0; a < ids.length; a++) activeIds[ids[a]] = true
        prevRunning.forEach(function (v, sid2) { if (!activeIds[sid2]) prevRunning.delete(sid2) })
        prevPending.forEach(function (v, sid2) { if (!activeIds[sid2]) prevPending.delete(sid2) })
        prevGoalPhase.forEach(function (v, sid2) { if (!activeIds[sid2]) prevGoalPhase.delete(sid2) })
        prevJobStatus.forEach(function (status, key) {
          var sep = key.indexOf(':')
          if (sep >= 0 && !activeIds[key.slice(0, sep)]) prevJobStatus.delete(key)
        })
      }

      var offSessions = sessionsList.subscribe(check)
      return function () { offSessions() }
    }

    function startWatcher(ctx, store) {
      var disposeMux = null
      var disposeHost = null
      var disposeSnap = null
      var gaveUp = false
      function useSnapshot() {
        if (gaveUp) return
        gaveUp = true
        if (disposeMux) { disposeMux(); disposeMux = null }
        if (disposeSnap) return
        disposeSnap = startSnapshotWatcher(ctx, store)
      }
      if (ctx.connection && ctx.connection.api && ctx.connection.api.events && typeof ctx.connection.api.events.mux === 'function') {
        disposeMux = startMuxWatcher(ctx, store, useSnapshot)
        if (typeof ctx.connection.api.events.host === 'function') {
          disposeHost = startHostWatcher(ctx, store)
        }
      } else {
        disposeSnap = startSnapshotWatcher(ctx, store)
      }
      return function () {
        if (disposeMux) disposeMux()
        if (disposeHost) disposeHost()
        if (disposeSnap) disposeSnap()
      }
    }

    function schedule(fn, ms) {
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') return window.setTimeout(fn, ms)
      return setTimeout(fn, ms)
    }

    function cancelSchedule(t) {
      if (t === null || t === undefined) return
      if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') window.clearTimeout(t)
      else clearTimeout(t)
    }

    /* ---------------- 设置界面 ---------------- */
    function useSnapshot(source) {
      var pair = React.useState(function () { return source.getSnapshot() })
      var setState = pair[1]
      React.useEffect(function () {
        return source.subscribe(function () {
          setState(source.getSnapshot())
        })
      }, [source])
      return pair[0]
    }

    // The client module loader exposes one CJS factory with no relative-module
    // resolver, so the dictionaries intentionally stay in this shipped bundle.
    var LOCALE_NS = 'dsh-sound'
    var DICTS = {
      zh: {
        'sound.ding': '叮咚', 'sound.chime': '风铃', 'sound.bell': '铃铛',
        'sound.complete': '完成', 'sound.success': '成功', 'sound.none': '静音', 'sound.local': '本地文件',
        'event.approval': '审批', 'event.question': '提问', 'event.planReview': '计划评审',
        'event.goalBlocked': '目标受阻', 'event.failure': '失败',
        'file.embeddedAudio': '内嵌音频', 'file.noneSelected': '尚未选择文件', 'file.replace': '更换',
        'file.choose': '选择', 'file.clickToPlay': '点击播放',
        'status.configUnavailable': '声音通知配置暂不可用。', 'section.title': '声音通知',
        'tab.mainAgent': '主 Agent', 'tab.subagents': '子代理', 'subagent.ignoreEvents': '忽略子代理事件',
        'transfer.title': '导入 / 导出', 'transfer.export': '导出', 'transfer.import': '导入',
        'control.volume': '音量', 'control.play': '播放',
      },
      en: {
        'sound.ding': 'Ding-dong', 'sound.chime': 'Chime', 'sound.bell': 'Bell',
        'sound.complete': 'Complete', 'sound.success': 'Success', 'sound.none': 'Mute', 'sound.local': 'Local file',
        'event.approval': 'Approval', 'event.question': 'Question', 'event.planReview': 'Plan review',
        'event.goalBlocked': 'Goal blocked', 'event.failure': 'Failure',
        'file.embeddedAudio': 'Embedded audio', 'file.noneSelected': 'No file selected', 'file.replace': 'Replace',
        'file.choose': 'Choose', 'file.clickToPlay': 'Click to play',
        'status.configUnavailable': 'Sound notification settings are unavailable.', 'section.title': 'Sound notifications',
        'tab.mainAgent': 'Main agent', 'tab.subagents': 'Subagents', 'subagent.ignoreEvents': 'Ignore subagent events',
        'transfer.title': 'Import / export', 'transfer.export': 'Export', 'transfer.import': 'Import',
        'control.volume': 'Volume', 'control.play': 'Play',
      },
      'pt-BR': {
        'sound.ding': 'Ding-dong', 'sound.chime': 'Carrilhão', 'sound.bell': 'Sino',
        'sound.complete': 'Conclusão', 'sound.success': 'Sucesso', 'sound.none': 'Silencioso', 'sound.local': 'Arquivo local',
        'event.approval': 'Aprovação', 'event.question': 'Pergunta', 'event.planReview': 'Revisão do plano',
        'event.goalBlocked': 'Objetivo bloqueado', 'event.failure': 'Falha',
        'file.embeddedAudio': 'Áudio incorporado', 'file.noneSelected': 'Nenhum arquivo selecionado', 'file.replace': 'Substituir',
        'file.choose': 'Escolher', 'file.clickToPlay': 'Clique para reproduzir',
        'status.configUnavailable': 'As configurações de notificações sonoras não estão disponíveis.', 'section.title': 'Notificações sonoras',
        'tab.mainAgent': 'Agente principal', 'tab.subagents': 'Subagentes', 'subagent.ignoreEvents': 'Ignorar eventos de subagentes',
        'transfer.title': 'Importar / exportar', 'transfer.export': 'Exportar', 'transfer.import': 'Importar',
        'control.volume': 'Volume', 'control.play': 'Reproduzir',
      },
      es: {
        'sound.ding': 'Timbre', 'sound.chime': 'Campanilla', 'sound.bell': 'Campana',
        'sound.complete': 'Completado', 'sound.success': 'Éxito', 'sound.none': 'Silencio', 'sound.local': 'Archivo local',
        'event.approval': 'Aprobación', 'event.question': 'Pregunta', 'event.planReview': 'Revisión del plan',
        'event.goalBlocked': 'Objetivo bloqueado', 'event.failure': 'Fallo',
        'file.embeddedAudio': 'Audio incorporado', 'file.noneSelected': 'No se ha seleccionado ningún archivo', 'file.replace': 'Reemplazar',
        'file.choose': 'Elegir', 'file.clickToPlay': 'Haz clic para reproducir',
        'status.configUnavailable': 'La configuración de notificaciones sonoras no está disponible.', 'section.title': 'Notificaciones sonoras',
        'tab.mainAgent': 'Agente principal', 'tab.subagents': 'Subagentes', 'subagent.ignoreEvents': 'Ignorar eventos de subagentes',
        'transfer.title': 'Importar / exportar', 'transfer.export': 'Exportar', 'transfer.import': 'Importar',
        'control.volume': 'Volumen', 'control.play': 'Reproducir',
      },
    }

    var SOUND_OPTIONS = [
      { key: 'ding', labelKey: 'sound.ding' }, { key: 'chime', labelKey: 'sound.chime' },
      { key: 'bell', labelKey: 'sound.bell' }, { key: 'complete', labelKey: 'sound.complete' },
      { key: 'success', labelKey: 'sound.success' }, { key: 'none', labelKey: 'sound.none' },
      { key: 'local', labelKey: 'sound.local' },
    ]

    var EVENTS = [
      { kind: 'completion', labelKey: 'sound.complete' }, { kind: 'approval', labelKey: 'event.approval' },
      { kind: 'question', labelKey: 'event.question' }, { kind: 'plan-review', labelKey: 'event.planReview' },
      { kind: 'goal-blocked', labelKey: 'event.goalBlocked' }, { kind: 'failure', labelKey: 'event.failure' },
    ]

    function isLocalValue(value) {
      return typeof value === 'string' && (value === 'local' || value.indexOf('data:') === 0 || value.indexOf('audio:') === 0)
    }

    function soundKeyOf(sound, kind, isSubagent) {
      if (isLocalValue(sound)) return 'local'
      if (BUILTIN_KEYS.indexOf(sound) >= 0) return sound
      return isSubagent ? 'none' : (SOUND_DEFAULT[kind] || 'ding')
    }

    function EnableSwitch(props) {
      var on = props.checked === true
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': props.label,
        className: 'dns-notify-switch' + (on ? ' is-on' : ''),
        onClick: function () { props.onChange(!on) },
      }, React.createElement('span', { className: 'dns-notify-switch-thumb' }))
    }

    /** 「本地文件」行：选择/更换按钮（隐藏 input）+ 可点击播放的已选文件名。 */
    function LocalFileRow(props) {
      var pair = React.useState('')
      var name = pair[0]
      var setName = pair[1]
      var inputRef = React.useRef(null)
      React.useEffect(function () {
        var alive = true
        setName('')
        if (props.audioId) {
          loadAudioMeta(props.audioId).then(function (n) { if (alive && n) setName(n) })
        }
        return function () { alive = false }
      }, [props.audioId])
      var hasFile = !!props.audioId || props.isData === true
      var label = props.isData ? props.t('file.embeddedAudio') : (name || (props.audioId ? props.t('sound.local') : props.t('file.noneSelected')))
      return React.createElement('div', { className: 'dns-notify-file-row' },
        React.createElement('button', {
          type: 'button',
          className: 'dns-notify-btn dns-notify-btn-sm',
          onClick: function () { if (inputRef.current) inputRef.current.click() },
        }, hasFile ? props.t('file.replace') : props.t('file.choose')),
        React.createElement('input', {
          type: 'file',
          accept: 'audio/*',
          style: { display: 'none' },
          ref: inputRef,
          'aria-label': hasFile ? props.t('file.replace') : props.t('file.choose'),
          onChange: function (ev) {
            var file = ev.target.files && ev.target.files[0]
            ev.target.value = ''
            if (file && props.onPicked) props.onPicked(file)
          },
        }),
        React.createElement('span', {
          className: 'dns-notify-file-name',
          title: hasFile ? props.t('file.clickToPlay') : undefined,
          'aria-label': hasFile ? props.t('control.play') + ': ' + label : undefined,
          onClick: hasFile ? props.onPlay : undefined,
        }, hasFile
          ? [React.createElement('span', { key: 'play', className: 'dns-notify-file-play' }, '\u25B6'), ' ' + label]
          : label))
    }

    /** Radio.Group + Radio.Button：七个分段按钮始终可见，点选即播。 */
    function SoundRadioGroup(props) {
      var buttons = SOUND_OPTIONS.map(function (opt) {
        var checked = props.soundKey === opt.key
        return React.createElement('label', {
          key: opt.key,
          className: 'dns-notify-radio-btn' + (checked ? ' is-checked' : ''),
        },
          React.createElement('input', {
            type: 'radio',
            name: 'dsh-sound-' + props.kind,
            value: opt.key,
            checked: checked,
            onChange: function () { props.onSound(opt.key) },
            onClick: function () { props.onPlay(opt.key) },
          }),
          props.t(opt.labelKey))
      })
      return React.createElement('div', {
        className: 'dns-notify-radio-group',
        role: 'radiogroup',
        'data-kind': props.kind,
        'aria-label': props.label,
      }, buttons)
    }

    /** 单类事件：名称 + 音量一行，下方 Radio.Button 组；选本地文件时再展开文件行。 */
    function EventRow(props) {
      var kind = props.kind
      var isSubagent = props.source === 'subagent'
      var stashKey = subagentKeyFor(kind, isSubagent)
      var sound = props.sound
      var volume = props.volume
      var soundKey = soundKeyOf(sound, kind, isSubagent)
      var audioId = typeof sound === 'string' && sound.indexOf('audio:') === 0 ? sound.slice(6) : null
      var hasLocalFile = isLocalValue(sound) && sound !== 'local'
      var playNow = function () { playImmediate(sound, props.cfg, volume) }
      var playKey = function (key) {
        if (key === 'none') return
        if (key === 'local') {
          var stashed = props.cfg.localFiles && props.cfg.localFiles[stashKey]
          var src = hasLocalFile ? sound : stashed
          if (isFileSound(src)) playImmediate(src, props.cfg, volume)
          return
        }
        if (key === soundKey) playNow()
        else playImmediate(key, props.cfg, volume)
      }
      var fileRow = soundKey === 'local'
        ? React.createElement(LocalFileRow, {
            audioId: audioId,
            isData: typeof sound === 'string' && sound.indexOf('data:') === 0,
            onPicked: props.onPicked,
            onPlay: playNow,
            t: props.t,
          })
        : null
      return React.createElement('div', { className: 'dns-notify-event' },
        React.createElement('div', { className: 'dns-notify-row' },
          React.createElement('span', { className: 'dns-notify-title' }, props.label),
          React.createElement('div', { className: 'dns-notify-controls' },
            React.createElement('input', {
              className: 'dns-notify-range',
              type: 'range',
              min: 0,
              max: 100,
              step: 1,
              value: Math.round((typeof volume === 'number' ? volume : 1) * 100),
              'aria-label': props.t('control.volume') + ': ' + props.label,
              onChange: function (ev) { props.onVolume(parseFloat(ev.target.value) / 100) },
            }),
            React.createElement('span', { className: 'dns-notify-pct' },
              Math.round((typeof volume === 'number' ? volume : 1) * 100) + '%'))),
        React.createElement(SoundRadioGroup, {
          kind: stashKey,
          soundKey: soundKey,
          label: props.label,
          onSound: props.onSound,
          onPlay: playKey,
          t: props.t,
        }),
        fileRow)
    }

    /* ---------------- 配置导入 / 导出 ---------------- */
    function collectAudioRefs(obj, refs, holder, key) {
      if (obj === null || obj === undefined) return
      if (typeof obj === 'string') {
        if (obj.indexOf('audio:') === 0) refs.push({ id: obj.slice(6), holder: holder, key: key })
        return
      }
      if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) collectAudioRefs(obj[i], refs, obj, i)
        return
      }
      if (typeof obj === 'object') {
        for (var k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) collectAudioRefs(obj[k], refs, obj, k)
        }
      }
    }

    function downloadJson(data) {
      try {
        var blob = new window.Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        var url = window.URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = 'dsh-sound-config-' + new Date().toISOString().slice(0, 10) + '.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      } catch (err) { /* 下载不可用时静默 */ }
    }

    /** 导出：IndexedDB 音频引用解析为 data URL 内嵌，得到可移植的完整配置。 */
    function exportConfig(cfg) {
      var out = JSON.parse(JSON.stringify(cfg))
      var refs = []
      collectAudioRefs(out, refs)
      if (refs.length === 0) { downloadJson(out); return }
      Promise.all(refs.map(function (r) {
        return loadAudio(r.id).then(function (url) { r.url = url || '' })
      })).then(function () {
        for (var i = 0; i < refs.length; i++) {
          refs[i].holder[refs[i].key] = refs[i].url
        }
        downloadJson(out)
      })
    }

    function importConfig(file, store) {
      var reader = new window.FileReader()
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result))
          if (parsed && typeof parsed === 'object') store.replace(parsed)
        } catch (err) { /* 无效 JSON：忽略 */ }
      }
      reader.onerror = function () {}
      reader.readAsText(file)
    }

    function makeSection(store, locale, t) {
      function Section() {
        var settingsSnap = useSnapshot(store)
        useSnapshot(locale)
        var cfg = configOf(settingsSnap)
        var importRef = React.useRef(null)
        var tabPair = React.useState('main')

        if (!cfg) {
          return React.createElement('div', { className: 'dns-notify-page' },
            React.createElement('div', { className: 'dns-notify-hint' }, t('status.configUnavailable')))
        }

        var setField = function (field, value) {
          var p = store.set(field, value)
          if (p && p.catch) p.catch(function () {})
        }
        var setSound = function (kind, value, source) {
          var isSubagent = source === 'subagent'
          var field = soundFieldFor(kind, isSubagent)
          var stashKey = subagentKeyFor(kind, isSubagent)
          var cur = cfg[field]
          var files = Object.assign({}, cfg.localFiles || {})
          var patch = {}
          if (value === 'local') {
            var stashed = files[stashKey]
            patch[field] = isFileSound(stashed) ? stashed : (isFileSound(cur) ? cur : 'local')
            store.patch(patch)
            return
          }
          if (isFileSound(cur)) files[stashKey] = cur
          patch[field] = value
          patch.localFiles = files
          store.patch(patch)
        }
        var setVolume = function (kind, value, source) { setField(volFieldFor(kind, source === 'subagent'), value) }
        var onPicked = function (kind, file, source) {
          var isSubagent = source === 'subagent'
          var field = soundFieldFor(kind, isSubagent)
          var stashKey = subagentKeyFor(kind, isSubagent)
          storeUploaded(file).then(function (value) {
            if (!value) return
            var c0 = configOf(store.getSnapshot())
            var prev = c0 && c0[field]
            var stashed = c0 && c0.localFiles && c0.localFiles[stashKey]
            if (prev && prev.indexOf('audio:') === 0 && prev !== value) removeAudio(prev.slice(6))
            else if (stashed && stashed.indexOf('audio:') === 0 && stashed !== value && stashed !== prev) {
              removeAudio(stashed.slice(6))
            }
            var files = Object.assign({}, (c0 && c0.localFiles) || {})
            files[stashKey] = value
            var picked = { localFiles: files }
            picked[field] = value
            store.patch(picked)
            var c = configOf(store.getSnapshot())
            if (c) playImmediate(value, c, volFor(c, kind, isSubagent))
          })
        }

        var buildEventRows = function () {
          return EVENTS.map(function (e) {
            return React.createElement(EventRow, {
              key: e.kind,
              kind: e.kind,
              source: 'main',
              label: t(e.labelKey),
              t: t,
              cfg: cfg,
              sound: cfg[SOUND_FIELD[e.kind]],
              volume: cfg[VOL_FIELD[e.kind]],
              onSound: function (v) { setSound(e.kind, v, 'main') },
              onVolume: function (v) { setVolume(e.kind, v, 'main') },
              onPicked: function (file) { onPicked(e.kind, file, 'main') },
            })
          })
        }

        var buildSubagentRows = function () {
          return EVENTS.map(function (e) {
            return React.createElement(EventRow, {
              key: 'subagent-' + e.kind,
              kind: e.kind,
              source: 'subagent',
              label: t(e.labelKey),
              t: t,
              cfg: cfg,
              sound: cfg[SUBAGENT_SOUND_FIELD[e.kind]],
              volume: cfg[SUBAGENT_VOL_FIELD[e.kind]],
              onSound: function (v) { setSound(e.kind, v, 'subagent') },
              onVolume: function (v) { setVolume(e.kind, v, 'subagent') },
              onPicked: function (file) { onPicked(e.kind, file, 'subagent') },
            })
          })
        }

        var enabled = cfg.enabled !== false
        var ignoreSubagent = cfg.ignoreSubagent === true
        var tab = tabPair[0]
        var setTab = tabPair[1]
        var tabClass = function (key) {
          return 'dns-notify-tab' + (tab === key ? ' is-active' : '')
        }
        return React.createElement('div', { className: 'dns-notify-page' },
          React.createElement('div', { className: 'dns-notify-row' },
            React.createElement('span', { className: 'dns-notify-title' }, t('section.title')),
            React.createElement(EnableSwitch, {
              checked: enabled,
              label: t('section.title'),
              onChange: function (next) { setField('enabled', next) },
            })),
          React.createElement('div', { className: 'dns-notify-tabs', role: 'tablist' },
            React.createElement('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'main' ? 'true' : 'false',
              className: tabClass('main'),
              onClick: function () { setTab('main') },
            }, t('tab.mainAgent')),
            React.createElement('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'subagent' ? 'true' : 'false',
              className: tabClass('subagent'),
              onClick: function () { setTab('subagent') },
            }, t('tab.subagents'))),
          tab === 'main'
            ? React.createElement('div', {
                className: 'dns-notify-events' + (enabled ? '' : ' is-disabled'),
              }, buildEventRows())
            : React.createElement('div', null,
                React.createElement('div', { className: 'dns-notify-row' },
                  React.createElement('span', { className: 'dns-notify-title' }, t('subagent.ignoreEvents')),
                  React.createElement(EnableSwitch, {
                    checked: ignoreSubagent,
                    label: t('subagent.ignoreEvents'),
                    onChange: function (next) { setField('ignoreSubagent', next) },
                  })),
                React.createElement('div', {
                  className: 'dns-notify-events' + (enabled && !ignoreSubagent ? '' : ' is-disabled'),
                }, buildSubagentRows())),
          React.createElement('div', { className: 'dns-notify-row' },
            React.createElement('span', { className: 'dns-notify-title' }, t('transfer.title')),
            React.createElement('div', { className: 'dns-notify-controls' },
              React.createElement('button', {
                type: 'button',
                className: 'dns-notify-btn',
                onClick: function () { exportConfig(cfg) },
              }, t('transfer.export')),
              React.createElement('button', {
                type: 'button',
                className: 'dns-notify-btn',
                onClick: function () { if (importRef.current) importRef.current.click() },
              }, t('transfer.import')),
              React.createElement('input', {
                type: 'file',
                accept: '.json,application/json',
                style: { display: 'none' },
                ref: importRef,
                onChange: function (ev) {
                  var file = ev.target.files && ev.target.files[0]
                  ev.target.value = ''
                  if (file) importConfig(file, store)
                },
              }))))
      }
      return Section
    }

    /* ---------------- 插件主体 ---------------- */
    var inject = ['slots', 'sessions', 'connection', 'locale']

    function apply(ctx) {
      if (crossTab) {
        try { crossTab.postMessage({ t: 'hello' }) } catch (err) { /* 频道已关 */ }
      }
      ctx.effect(function () {
        var locales = ctx.locale.getLocale().locales
        var hasLocale = function (id) {
          var target = id.toLowerCase()
          return locales.some(function (locale) { return String(locale.id).toLowerCase() === target })
        }
        var disposers = [
          hasLocale('pt-BR') ? function () {} : ctx.locale.addLanguage({ id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en' }),
          hasLocale('es') ? function () {} : ctx.locale.addLanguage({ id: 'es', label: 'Español', fallback: 'en' }),
          ctx.locale.register(LOCALE_NS, 'zh', DICTS.zh),
          ctx.locale.register(LOCALE_NS, 'en', DICTS.en),
          ctx.locale.register(LOCALE_NS, 'pt-BR', DICTS['pt-BR']),
          ctx.locale.register(LOCALE_NS, 'es', DICTS.es),
        ]
        return function () {
          for (var i = disposers.length - 1; i >= 0; i--) disposers[i]()
        }
      }, 'dsh-sound: locale dictionaries')
      var t = ctx.locale.bind(LOCALE_NS)
      var store = createConfigStore()
      var disposeWatcher = startWatcher(ctx, store)
      ctx.effect(function () { return disposeWatcher })
      var Section = makeSection(store, ctx.locale, t)
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-sound',
          order: 90,
          label: function () { return t('section.title') },
        }, Section)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
