// Host-half behavioral test for dsh-sound (run with: node tools/test-host.mjs)
import { apply, inject, name, Config } from '../lib/index.js'

let failures = 0
const ok = (cond, label) => {
  if (cond) console.log('PASS', label)
  else { failures++; console.log('FAIL', label) }
}

ok(name === 'dsh-sound', 'name export')
ok(Array.isArray(inject) && inject.length === 0, 'inject export is empty array')

// 1) settings service never appears -> silent no-op (late inject never fires)
let threw = false
try {
  apply({ inject: (deps, cb) => { /* never call cb */ } })
} catch (e) { threw = true }
ok(!threw, 'apply without settings service does not throw and waits silently')

// 2) settings service appears -> namespace registered with applies live
let registered = null
const fakeSettings = {
  register: (ns, schema, opts) => { registered = { ns, schema, opts }; return {} },
}
apply({
  inject: (deps, cb) => {
    if (deps.includes('settings')) cb({ settings: fakeSettings })
  },
})
ok(registered && registered.ns === 'dsh-sound', 'namespace registered as dsh-sound')
ok(registered && registered.opts.applies === 'live', 'applies=live')

// 3) schema resolves defaults (0.3.0: six independent sounds + six volumes)
const resolved = registered.schema({})
ok(resolved.enabled === true, 'default enabled=true')
ok(resolved.quietCurrent === false, 'default quietCurrent=false')
ok(resolved.completionSound === 'chime', 'default completionSound=chime')
ok(resolved.approvalSound === 'ding', 'default approvalSound=ding')
ok(resolved.questionSound === 'ding', 'default questionSound=ding')
ok(resolved.planReviewSound === 'ding', 'default planReviewSound=ding')
ok(resolved.goalBlockedSound === 'ding', 'default goalBlockedSound=ding')
ok(resolved.failureSound === 'bell', 'default failureSound=bell')
ok(resolved.completionVolume === 1, 'default completionVolume=1')
ok(resolved.approvalVolume === 1, 'default approvalVolume=1')
ok(resolved.questionVolume === 1, 'default questionVolume=1')
ok(resolved.planReviewVolume === 1, 'default planReviewVolume=1')
ok(resolved.goalBlockedVolume === 1, 'default goalBlockedVolume=1')
ok(resolved.failureVolume === 1, 'default failureVolume=1')
ok(resolved.ignoreSubagent === false, 'default ignoreSubagent=false')
ok(resolved.subagentCompletionSound === 'none', 'default subagentCompletionSound=none')
ok(resolved.subagentApprovalSound === 'ding', 'default subagentApprovalSound=ding')
ok(resolved.subagentQuestionSound === 'ding', 'default subagentQuestionSound=ding')
ok(resolved.subagentPlanReviewSound === 'ding', 'default subagentPlanReviewSound=ding')
ok(resolved.subagentGoalBlockedSound === 'bell', 'default subagentGoalBlockedSound=bell')
ok(resolved.subagentFailureSound === 'bell', 'default subagentFailureSound=bell')
ok(resolved.subagentCompletionVolume === 1, 'default subagentCompletionVolume=1')
ok(resolved.subagentApprovalVolume === 1, 'default subagentApprovalVolume=1')
ok(resolved.subagentQuestionVolume === 1, 'default subagentQuestionVolume=1')
ok(resolved.subagentPlanReviewVolume === 1, 'default subagentPlanReviewVolume=1')
ok(resolved.subagentGoalBlockedVolume === 1, 'default subagentGoalBlockedVolume=1')
ok(resolved.subagentFailureVolume === 1, 'default subagentFailureVolume=1')

// 4) schema resolves a real section (custom data URL + per-event volumes)
const full = registered.schema({
  enabled: false,
  quietCurrent: true,
  completionSound: 'data:audio/mp3;base64,AAAA',
  failureSound: 'none',
  approvalVolume: 0.3,
  failureVolume: 0.5,
  ignoreSubagent: true,
  subagentCompletionSound: 'bell',
  subagentFailureVolume: 0.25,
})
ok(full.enabled === false && full.quietCurrent === true, 'user values preserved')
ok(full.completionSound === 'data:audio/mp3;base64,AAAA', 'custom data URL preserved')
ok(full.failureSound === 'none', 'none preserved')
ok(full.approvalVolume === 0.3 && full.failureVolume === 0.5, 'per-event volumes preserved')
ok(full.ignoreSubagent === true, 'ignoreSubagent preserved')
ok(full.subagentCompletionSound === 'bell', 'subagentCompletionSound preserved')
ok(full.subagentFailureVolume === 0.25, 'subagentFailureVolume preserved')

// 5) schema rejects invalid sections
for (const bad of [
  { enabled: 'yes' },
  { completionVolume: 1.5 },
  { approvalVolume: -0.1 },
  { completionSound: 42 },
  { ignoreSubagent: 'yes' },
  { subagentCompletionVolume: 1.5 },
  { subagentApprovalSound: 42 },
]) {
  let rejected = false
  try { registered.schema(bad) } catch (e) { rejected = true }
  ok(rejected, 'rejects invalid section: ' + JSON.stringify(bad))
}

console.log(failures === 0 ? 'ALL HOST TESTS PASSED' : failures + ' FAILURES')
process.exit(failures === 0 ? 0 : 1)
