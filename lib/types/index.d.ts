import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'

/**
 * `dsh-sound` 的配置结构。
 *
 * 客户端将其持久化在浏览器 localStorage（键 `dsh-sound:config`）；
 * 宿主端同时注册同名 settings 命名空间（rc.6 的 settings API 白名单暂不
 * 向浏览器暴露第三方命名空间，待平台开放后客户端可无缝切换回 settingsScope）。
 *
 * 六类事件完全独立：每类都有自己的声音与音量。子代理（subagent）来源的
 * 同类事件另有独立的一套声音与音量（默认全部静音），并可用 `ignoreSubagent`
 * 一次性忽略全部子代理事件。声音值：
 * 内置键（ding | chime | bell | complete | success | none）、'local'（本地文件待选）、
 * 'data:…'（内嵌数据 URL）、'audio:<id>'（IndexedDB 音频库引用）。
 */
export interface NotifySoundConfig {
  /** 总开关 */
  enabled: boolean
  /** 当前正在查看的会话「完成」时不响铃（注意类事件不受此限制） */
  quietCurrent: boolean
  /** 忽略全部子代理（subagent）事件 */
  ignoreSubagent: boolean
  /** 完成铃声（会话回合结束 / 后台任务完成） */
  completionSound: string
  /** 审批请求声音 */
  approvalSound: string
  /** 用户提问声音 */
  questionSound: string
  /** 计划评审声音 */
  planReviewSound: string
  /** 目标受阻声音 */
  goalBlockedSound: string
  /** 后台任务失败声音 */
  failureSound: string
  /** 完成事件音量 0..1 */
  completionVolume: number
  /** 审批请求音量 0..1 */
  approvalVolume: number
  /** 用户提问音量 0..1 */
  questionVolume: number
  /** 计划评审音量 0..1 */
  planReviewVolume: number
  /** 目标受阻音量 0..1 */
  goalBlockedVolume: number
  /** 后台任务失败音量 0..1 */
  failureVolume: number
  /** 子代理完成事件声音（默认 none） */
  subagentCompletionSound: string
  /** 子代理审批请求声音（默认 none） */
  subagentApprovalSound: string
  /** 子代理用户提问声音（默认 none） */
  subagentQuestionSound: string
  /** 子代理计划评审声音（默认 none） */
  subagentPlanReviewSound: string
  /** 子代理目标受阻声音（默认 none） */
  subagentGoalBlockedSound: string
  /** 子代理后台任务失败声音（默认 none） */
  subagentFailureSound: string
  /** 子代理完成事件音量 0..1 */
  subagentCompletionVolume: number
  /** 子代理审批请求音量 0..1 */
  subagentApprovalVolume: number
  /** 子代理用户提问音量 0..1 */
  subagentQuestionVolume: number
  /** 子代理计划评审音量 0..1 */
  subagentPlanReviewVolume: number
  /** 子代理目标受阻音量 0..1 */
  subagentGoalBlockedVolume: number
  /** 子代理后台任务失败音量 0..1 */
  subagentFailureVolume: number
}

export declare const name: 'dsh-sound'
export declare const inject: string[]
export declare const Config: z<NotifySoundConfig>
export declare function apply(ctx: Context): void
