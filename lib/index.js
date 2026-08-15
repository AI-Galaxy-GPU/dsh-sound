/**
 * dsh-sound — Host 半体
 *
 * 注册 `dsh-sound` 设置命名空间（schema 见 Config），为将来平台
 * 开放第三方命名空间暴露机制预留配置通道。当前 rc.6 的 settings API
 * 白名单（dsh-host-apiproxy）不会把该命名空间暴露给浏览器，因此客户端
 * 使用 localStorage 持久化配置；本注册保持无害且兼容未来版本。
 *
 * 命名空间值结构（schemas 已含默认值）：
 * {
 *   enabled: boolean              // 总开关
 *   quietCurrent: boolean         // 当前正在查看的会话完成时不响铃
 *   completionSound: string       // 完成铃声（回合结束 / 后台任务完成）
 *   approvalSound / questionSound / planReviewSound /
 *   goalBlockedSound / failureSound: string   // 五类注意事件专属声音
 *   completionVolume / approvalVolume / ... : number  // 每类事件独立音量 0..1
 * }
 * 声音值：内置键（ding|chime|bell|complete|success|none）、'local'（本地文件待选）、
 * 'data:…'（内嵌数据 URL）、'audio:<id>'（IndexedDB 音频库引用）。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-sound'
export const inject = []

export const Config = z.object({
  enabled: z.boolean().default(true),
  quietCurrent: z.boolean().default(false),
  completionSound: z.string().default('chime'),
  approvalSound: z.string().default('ding'),
  questionSound: z.string().default('ding'),
  planReviewSound: z.string().default('ding'),
  goalBlockedSound: z.string().default('ding'),
  failureSound: z.string().default('bell'),
  completionVolume: z.number().min(0).max(1).default(1),
  approvalVolume: z.number().min(0).max(1).default(1),
  questionVolume: z.number().min(0).max(1).default(1),
  planReviewVolume: z.number().min(0).max(1).default(1),
  goalBlockedVolume: z.number().min(0).max(1).default(1),
  failureVolume: z.number().min(0).max(1).default(1),
})

export function apply(ctx) {
  // settings 服务（dsh-settings-file）在启动时异步加载文档后才可用；
  // 用 ctx.inject 迟绑定：settings 就绪后（或早已就绪时立即）再注册；
  // 完全没有 settings 服务的 profile 中则静默不注册。
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.register('dsh-sound', Config, { applies: 'live' })
  })
}
