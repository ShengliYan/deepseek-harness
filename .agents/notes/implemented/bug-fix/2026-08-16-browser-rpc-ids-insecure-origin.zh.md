# Agent Note：不安全来源上的浏览器 RPC id

Status: implemented

[English](2026-08-16-browser-rpc-ids-insecure-origin.md) | 中文

## 问题

浏览器载体的每一个 rpcId 都经 `AbstractApiClient.mintRpcId` 签发，它直接调用 `crypto.randomUUID()`。`crypto.randomUUID` 只在安全来源（HTTPS 或 localhost）存在。浏览器经局域网或 Tailnet 地址上的普通 HTTP 打开 Web GUI 时处于不安全来源，该属性为 `undefined`：每个 RPC 在签发环节即抛错，侧边栏渲染不出任何工作区、任何会话都加载不了，新建工作区报 `crypto.randomUUID is not a function`。桌面壳加载的 loopback 来源（`http://127.0.0.1:<port>`）是安全上下文，所以同一台服务器只从远程设备看是坏的。

`dsh-client-connection` 本就带着一个本地 `randomUuid()`，基于 `crypto.getRandomValues`（不安全来源也提供该 API）给自己的通用通道调用方用；也就是说传输层存在两个 id 签发器，而恰好只有未共享的那个对安全上下文免疫。`dsh-client-ui-conversation` 的浏览器草稿附件 id 也裸用 `crypto.randomUUID()`，图片摄入在不安全来源上同样失败。

## 决策

共享 helper 移入两个浏览器界面都已依赖的传输包：`@deepseek-ai/dsh-host-apiproxy/random-uuid` 用 `crypto.getRandomValues` 组装 RFC 4122 version 4 UUID，hex 编码前先在 DataView 上强制 version 与 variant 位。`mintRpcId` 改用它，因此每个载体（浏览器、in-process 及未来子类）的签发一致且不再要求安全上下文。`dsh-client-connection` 的两处调用改为导入该导出，本地副本删除。`dsh-client-ui-conversation` 声明 `dsh-host-apiproxy` 依赖（package.json 加 tsconfig reference；这是对库的值导入，不是 plugin-to-plugin），草稿附件 id 经它签发。

## 备选方案

**用 HTTPS 提供 GUI。**暂缓：webserver 有意只绑明文 HTTP，经 SSH 隧道或 Tailscale 地址的远程访问是受支持的部署形态；强制 TLS 还会破坏 loopback 桌面壳的同源假设。去掉安全上下文要求让所有受支持的来源都能工作。

**在壳里 polyfill `crypto.randomUUID`。**否决：应用代码改写平台全局只会掩盖要求而非移除要求，零散的直调点也不会因此收敛。

**在 `ui-conversation` 再留一份副本。**否决：仓库有跨文件克隆检测门禁，且 wire 关联原语出现两份实现正是共享导出要防止的重复。

## 后果

信任栅栏放行的每一个浏览器来源--loopback、trusted-host、经明文 HTTP 的局域网/Tailnet IP 字面量--都能签发 rpcId 与草稿附件 id。host 侧的 `crypto.randomUUID` 调用方（LLM 消息 id、匿名身份、命令实例 token）不受影响：Node 的 `crypto.randomUUID` 没有安全上下文限制。单测桩出一个只有 `getRandomValues` 的 crypto 对象，断言 `randomUuid()` 与 `mintRpcId()` 在其上产出 version-4 id，并断言环境 crypto 下多次调用互不相同。
