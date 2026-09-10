# Agent Note：2026-09-10 双机整合——冲突裁决记录

Status: implemented

[English](2026-09-10-integration-0910-conflict-decisions.md) | 中文

## 问题

`integration/0910` 分支要把固定的上游目标 `b2e3b2a012`（0.1.5-alpha.2）并入 Mac 保存分支（`save/mac-0910`，0.1.2-alpha.1 分叉 + macOS 打包管线、两位小数缓存显示、版本切换器与 rewind 文案、web-search provider 修复），之后再合入 hgg 保存分支（浏览器 401 token 表单）。两侧因上游对 session 控制器、stats UI、聊天滚动模型的重写而分叉，64 个冲突文件里的大多数需要把我们自己的行为逐一适配到新的上游结构上，而不是整边取舍。

## 决策

**分叉提交 `756e2c3830`（无安全上下文时铸造浏览器 rpc id）不直接 cherry-pick。** 上游目标已携带等效机制：`packages/client/connection/src/client/random-uuid.ts` 被 `src/client/rpc.ts` 与 `src/client/fixture.ts` 导入（正是分叉提交用别的方式改过的两个文件），host 侧的 `randomUUID()` 归 `packages/util/crypto` 所有。合并树使用上游路径；分叉提交的原始 note 留在分叉历史里作为出处。

**Session 控制器。** 候选版把 `reject(...)` 重写为 `throw new RemoteError('session/...')`，并引入带品牌类型的 `SessionSeq`/`SessionLogOffset`/`SessionId`。我们的 `rewind` fork 选项移植进该结构：`commands.ts` 里用 `findLast` 在 `turn/start` 事件上定位锚点、首轮回退用 `emptyRewindChild`、`SessionLogOffset(0)` 切点、返回 `{ sessionId, blank }`；`manager.ts` 在候选版 `RemoteResult` 流程上保留 `rewind` 选项与 `blank` 摘要字段。`service.ts` 通过候选版的 `SessionSeq(Math.floor(opts.atSeq))` 锚点透传 `rewind`。host spec 改用候选版的 `Session.snapshotEvents()`（取代分叉时期的 `session.events`）断言子会话内容。

**Stats。** 上游用 `StatsPills.tsx`（+ `TurnUsagePanel`、`stat-dialog.ts`）替换了 `StatsLine.tsx`。我们的两位小数缓存命中显示移入 `StatsPills.tsx`：`roundedHundredthPercent`（四舍五入到百分位、上限 `9_999`、未命中为零时取 `100.00`）驱动 `cacheHitPercent`，渲染 `99.50` 风格的字符串；`formatCacheHitPercent` 留在 `token-format.ts` 供 `TurnUsagePanel` 使用（一位小数，不变）。37 个冲突的 web 快照全部解析为候选版的 pill 结构 + 我们的两位小数值（取自各 hunk 我们的那一侧，与夹具的精确比例一致），我们改过 rewind 文案的位置保留我们的文案。`chat-stats.client.spec.tsx` 采用候选版的 pill 断言 + 我们的边界值表；已删除组件的 hover-tooltip 测试随组件一起移除。

**聊天滚动。** `ChatView.tsx` 采用候选版的滚动重构（采样式 `onScroll`、`readerMovedScroll`、memo 化的 `ChatNodeList`、`realizePendingJump`/`loadThrough` 跳转重锚），并在其上保留我们全部分页行为：`PAGING_TRIGGER = 2`、短窗自动分页（layout effect 内）、三处 `loadOlderAnchored` 续拉点、以及清除锚点的 `loadingOlderWasRef` true→false 转换（普通 pull 与跳转的交互由候选版的 jump settle tick 负责）。`ChatNodeSeat`/`slots` 同时携带两侧 props：我们的 `rewindAt`/`openVersion` + 候选版的 `loadImage` 与新 `useChatNode`/`useChatNodeProcess` 座位。

**ModelSelect（功能碰撞，按"保留用户行为"裁决）。** 上游新增 `IconDataOutline16` 数据库图标 + 360px 纯图标截断（其注释理由涉及 effort 省略行）；我们有 fish 图标 + 460px 截断（与兄弟 `PermissionSelect` chip 同步，且是计划验收项里的品牌功能）。裁决：fish 图标保留，上游 360px 的 `.triggerIcon` 块删除（会对同一属性重复声明），未用的图标 import 移除，460px 断点保留。

**Providers 文档。** 两组 bullet 都保留：我们详细的 `reasoningEfforts` 说明 + 候选版新增的"`off` 不会让 DeepSeek 模型停止思考 / `compat.thinkingFormat: deepseek`"说明，双语同步。

**桌面运行时 manifest。** `apps/desktop-runtime/package.json` 由 `macos-app/scripts/stage-runtime.mjs` 基于三个 manifest + 手工维护的 `WEB_PROFILE_PLUGINS` 列表生成；列表里还残留分叉时期的 `@deepseek-ai/dsh-tool-subagent-report`，候选版已将其并入 `tool-subagent`。常量中删除该过期条目（其余 122 条逐一对照合并后工作区验证），并按脚本自身的闭包逻辑重生成 manifest——221 个依赖，家族版本 0.1.5-alpha.2。`pnpm-lock.yaml` 以候选版为基线重生成，纯增量 importer（`apps/desktop-runtime`、`packages/web/web-search-ark`），无第三方版本变动。

**Web 搜索设置 API。** 候选版 settings 包弃用了 `installSettingsSection`，改为 `ctx.inject(['settings'], …)` 之后的 `ctx.settings.installSection(owner, ns, schema, entry, hooks)`。Ark provider 的 `apply` 迁移到该模式（命名空间现为类型系统校验的普通字面量），与 `llm-pi-ai`/`llm-deepseek` 的消费方式一致。

## 备选方案

**在合并之上 cherry-pick `756e2c3830`。** 否决：会把分叉时期的 uuid  workaround 重新塞进已被上游机制取代的位置。

**快照整边取舍。** 否决：整取我们的会复活已删除的 `StatsLine` 结构；整取候选版的会丢掉两位小数显示——本次整合的用户可见功能。

**ModelSelect 双图标/双截断并存。** 否决：不同查询断点上两个 `.triggerIcon` 声明会争抢同一元素；一个图标 + 一个截断才符合兄弟 chip 的约定。

## 后果

合并提交以候选版为结构基底承载适配后的行为；hgg 保存分支以独立合并提交叠加其上。3 个被重新触碰的双语对（两个包 README、providers 指南）在 stage 前通过 `verify-translation-pairing --write` 重录。候选验收（§6）仍需证明组装后的输出：`test:gui`、replay 的 `DSH_SNAPSHOT=replay test:web` 测试道、以及双平台的隔离 App/`start-dsh-web.ps1` 运行。
