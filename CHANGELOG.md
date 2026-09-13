# Changelog

## 0.4.0 (2026-09-12) — 子代理事件独立通道

- 新增「子代理事件」分区：完成 / 审批 / 提问 / 计划评审 / 目标受阻 / 失败六类各自独立
  配置声音与音量，默认**全部静音**；分区顶部「忽略子代理事件」开关一键静默全部
  子代理事件。
- 子代理来源双通道判定：一次性子代理任务（`session/jobs` 帧 `job.kind === 'subagent'`）
  与子代理会话（列表行 `origin === 'subagent'` / `parentId`），mux 事件流与快照兜底
  两条路径同时生效；主 agent 事件行为不变。解决并行子代理完成音连响的问题（#3）。
- 包名改为 `@ai-galaxy/dsh-sound`（npm 上 `dsh-sound` 为第三方占位包），
  `cordis.patch.yml` 的 bundle 解析名同步更新；安装命令改为
  `dsh plugin --profile web add @ai-galaxy/dsh-sound`（发版前可用
  `github:AI-Galaxy-GPU/dsh-sound`）。
- 客户端模块注册 id 同步改为 `@ai-galaxy/dsh-sound`：DSH 的 client-modules
  按完整包名等待注册，改名后仍注册旧 id 会导致整个插件加载失败。
- 配置新增 13 个字段（`ignoreSubagent`、六类子代理声音、六类子代理音量），
  旧配置读取时自动补默认值；`localFiles` 新增 `subagent-<kind>` 键；
  导出 / 导入自动覆盖新字段。
- 设置页改为 **主 Agent / 子代理** 两个 Tab：总开关与导入/导出常驻，
  子代理 Tab 内含六类事件行与「忽略子代理事件」开关，不再竖向堆叠两组长列表。
- 宿主端 settings schema 与 `lib/types/index.d.ts` 同步。

## 0.3.3 (2026-08-16)

- 内置音与「本地文件」之间切换时保留已选文件（IndexedDB / data URL 不删），切回仍是原文件。
- 设置页音量滑块加长。

## 0.3.2 (2026-08-16) — 设置页改为 Setting-Cell

- 设置页改为竖向 hairline 列表：总开关一行、六类事件（标题 + 音量，下方 Radio.Button 组）、导入/导出一行。
- 声音选择为 Radio.Group + Radio.Button 分段按钮；点击即选中并播放（静音不播）。
- 选「本地文件」时才在该行下方展开选择/更换与文件名。

## 0.3.1 (2026-08-16) — 少误响

- `turn/end` 按 `reason.kind` 分流：`completed` 才响完成音，`error` 响失败音，
  `aborted` / `blocked` / `max-tokens` / `interrupted` 静音（用户点停止不再当「回答完成」）。
- 后台任务 `killed` 静音，不再走完成音。
- mux 打开时回放的 `approval/requested` / `question/requested`（刷新恢复）不响；
  同一 `rpcId` 只响一次，避免重连再响。
- 订阅 `events.host` 的 `host/agent-error`（没有 turn 位置的循环失败）。
- 计划评审优先看列表快照的 `pendingInteraction`，与 SessionManager 对齐。
- 单标签页不再为 BroadcastChannel 空等 40ms；确认有同伴标签后才握手。
- mux 连续解不出 `type` 时放弃事件流，降级为会话快照 diff。

## 0.3.0 (2026-08-16) — 功能简化

- 六类事件（完成 / 审批 / 提问 / 计划评审 / 目标受阻 / 任务失败）完全独立：
  各自配置声音与音量，不再有「通用注意音 / 跟随」结构。
- 每个事件的音量可单独设置（0–100% 滑块，共 6 个），取代全局音量。
- 设置面板声音选择由下拉框改为 radio 单选组（叮咚 / 风铃 / 铃铛 / 完成 / 成功 /
  静音 / 本地文件）；选择「本地文件」时该事件行下方出现文件选择框，
  上传文件存入 IndexedDB（记录文件名并展示已选文件）。
- 去掉「试听」按钮：点击所选声音选项（或已选文件名）直接播放；
  本地文件行优化为「选择/更换音频文件…」按钮 + 可点击播放的文件名（▶）。
- 修复 watcher 状态表内存泄漏：mux / 快照路径按当前会话列表清理已销毁会话的
  job / goal / running / pending 状态，不再无限增长。
- 多标签页去重：BroadcastChannel 广播「播放意图」，同一次事件只在一个标签页响铃
  （随机 nonce 决胜；40ms 握手窗口，单标签页几乎无感）。
- mux 重连指数退避：800ms 起翻倍、30s 封顶，收到帧即复位（原固定 800ms 空转）。
- 畸形 job 帧防御（缺 id / null 忽略不崩溃）；同步 package-lock.json 版本号至 0.3.0。
- 修复本地文件（MP3 等）事件触发时不响：播放链路从 HTMLAudioElement（受自动播放
  策略限制）改为 Web Audio `decodeAudioData` + BufferSource，与内置合成音共用已解锁的
  AudioContext；无 Web Audio 解码能力时回退 Audio 元素；同一文件解码结果缓存复用。
- **修复事件检测完全失效（重要）**：真实运行时 `events.mux` 产出的是 RpcRequest
  **信封**（帧在 `envelope.payload`），此前直接把信封当帧解析导致所有事件被忽略
  （面板点击能响、事件触发全无声）。现自动解包信封并兼容旧式裸帧形态。
- 移除语音播报（TTS）：voice / voiceName / voiceRate / attentionPhrase 及语音设置区块全部删除。
- 移除按工作区配置（workspaces）与合并窗口（debounceMs）：事件即时播放，
  仅保留同源 400ms 去抖（防重复帧），不再合并不同事件。
- 旧配置自动迁移：`defaultSound` → `completionSound`，voice 值降级为各类默认音，
  workspaces / debounceMs / 全局 volume 等旧字段忽略。
- 宿主端 schema 同步为六声音 + 六音量字段。

## 0.2.0 (2026-08-16) — optimization pass

- 事件检测升级为连接层事件流（`events.mux` 帧级监听）：回合结束、任务状态迁移、
  goal 投影、审批/提问请求按帧精确检测，「任务创建即完成」等快速任务不再漏响；
  事件流不可用时自动降级为快照 diff。
- 合并窗口：同一 `debounceMs`（默认 400ms，0–5000 可配置）内多个事件只响最高优先级的一声
  （失败 > 目标受阻 > 审批/提问/计划评审 > 完成），不再连响或互相吞掉。
- 全局音量（0–100%）：合成音 / TTS / 自定义音频统一生效。
- 按工作区注意音覆盖：`workspaces` 行新增 `attentionSound`，该工作区的审批/提问/失败等事件
  优先使用工作区注意音，其次才是全局注意音。
- 本地音乐导入：上传音频存入 IndexedDB（`dsh-sound-audio`），突破 localStorage 5MB 配额。
- 配置导入/导出：完整配置可下载为 JSON（音频引用内嵌 data URL）并恢复。
- 去抖表定期清理（5 分钟窗口），修复 session/job key 无限增长的内存泄漏。

## 0.1.0 (2026-08-16)

- 插件名、设置命名空间、localStorage 键（`dsh-sound:config`）、settings.section 贡献 id 为 `dsh-sound`。
- 设置面板标题为「声音通知」。

## 1.0.0 (2026-08-14)

- 按工作区定制任务完成铃声：回合结束（`running: true → false`）与后台任务完成时播放。
- 内置 5 种 Web Audio 合成铃声（叮咚 / 风铃 / 铃铛 / 完成 / 成功）+ 静音。
- 语音播报：浏览器 TTS（系统中文语音）朗读自定义文案，可选声音与语速。
- 自定义音频：上传任意音频文件（data URL 存于浏览器）。
- 需要人介入事件的注意提示音（始终响铃，不受「当前会话不响铃」限制）：
  - 审批请求（`pendingInteraction: approval`）
  - 用户提问（`question`）
  - 计划评审（`plan-review`）
  - 目标受阻（goal 投影进入 `blocked`）
  - 后台任务失败（区别于正常完成，独立失败音）
- 每类注意事件可单独覆盖声音，或跟随通用注意音；支持语音播报共用文案。
- 设置面板（设置 → 通知铃声）：总开关、完成铃声（默认 + 每工作区）、
  注意铃声（通用 + 五类）、语音设置（声音 / 语速 / 试听 / 刷新列表）、上传与试听。
- 配置持久化于浏览器 localStorage；宿主端注册 `dsh-sound` 设置命名空间
  （rc.6 settings API 白名单不向浏览器暴露第三方命名空间，注册为未来迁移预留）。
- 以 bundle 形式发布：`dsh plugin --profile <name> add dsh-sound` 一键安装。
