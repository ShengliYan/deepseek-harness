# Agent Note：回退入口与会话标题栏中的 fork 谱系

Status: implemented

[English](2026-08-16-rewind-affordance-and-fork-lineage.md) | 中文

## 问题

harness 已经具备完整的 fork 原语——`session.fork` 从已完成轮次的前缀切出子会话，Web 客户端也从消息分支图标与 Session 行菜单暴露它——但 Codex 式的「回到更早的某一点」不可发现：消息图标只读作「分支」，且 fork 之后子会话上没有任何痕迹表明它从何而来。标题栏的谱系面包屑此前刻意只沿 `origin: 'subagent'` 链上溯，因此 fork 子会话渲染得如同根会话，用户无法回到播种它的源头会话。

## 决策

既有的 fork-and-open 流程就是回退原语；本次改动为它命名，并让它的谱系可见。

文案：消息分支入口现在读作 从此处回退，在新会话中继续 / *Rewind here - continue in a new conversation*，Session 行菜单项读作 回退到上一轮（新会话） / *Rewind to the previous turn (new session)*。行为未变——两个入口仍然经由 runtime 共享的 `sessions.fork` 动作 fork、递增继承标题并打开子会话；失败仍保持源会话选中。

谱系：`deriveAncestry` 现在无条件沿 `parentId` 上溯（最旧在前、当前在末位、可终止循环），而不是停在第一个非 subagent 摘要处。`parentId` 是线上 `parentSessionId` 的透传，本来就同时承载 fork 与 subagent 谱系，因此这次改动纯属可见性决策：fork 子会话的标题栏把源会话显示为可点击面包屑，自己的标题显示为禁用的尾屑。根会话、孤儿父链与循环和以前一样退化为单一当前屑。

## 备选方案

**真正原地回退、截断会话日志。**否决：会话日志只追加，模型可见内容必须能从日志重建（`Model-visible ⟺ logged`）；截断原语会削弱该不变量，而 fork 已经能在不摧毁未来分支的前提下表达「从更早的已完成轮次继续」。

**在会话列表里把 fork 子会话嵌套到源会话之下。**否决：同级行模型（两行都独立可选、可搜索、可拖拽排序）是既定决策（[2026-07-27-web-session-fork-actions](../../archived/feature/2026-07-27-web-session-fork-actions.md)）；标题栏面包屑在不改变列表归属的前提下补上谱系导航。

**保留仅 subagent 的面包屑，另加一个 fork 芯片。**否决：一个谱系界面更简单，且两种谱系共用同一个 `parentId` 字段。

## 后果

fork 子会话的标题栏显示其源头链；点击面包屑打开对应祖先。subagent 面包屑不变。根会话渲染单个屑。文案改动涉及两份 locale（zh/en）、按名称寻址这些按钮的组件 spec，以及 message-actions 的 Web 快照 goldens（同批刷新）。单测钉住 `deriveAncestry` 的 fork 链、多跳 subagent、孤儿与循环行为；message-actions e2e 额外断言 fork 后的两屑标题栏与面包屑导航。
