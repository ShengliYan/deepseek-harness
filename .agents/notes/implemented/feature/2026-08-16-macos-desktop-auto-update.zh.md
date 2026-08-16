# Agent Note：macOS 桌面端自动更新管线

Status: implemented

[English](2026-08-16-macos-desktop-auto-update.md) | 中文

## 问题

Electron 桌面壳（`macos-app`）只能通过手工构建的 dmg/zip 产物触达机器：旧 bundle 上的用户会一直停留在旧版本，直到自己发现并手动重装。主流更新器都装不上：Electron 的 `autoUpdater` 说 Squirrel.Mac，其更新 feed 假定代码签名构建；Sparkle 是 Objective-C 框架，带有同样的签名形态假设。这个壳刻意不签名（`identity: null`），因此它需要一条不依赖签名、也不依赖签名管线的更新通道。

## 决策

壳内置自研更新循环，从构造上就不依赖签名。每次 `dist:mac*` 构建都会盖一个 `build-id`，并经 `scripts/make-update-feed.mjs` 产出一份 `latest.json` feed（`version`、`buildId`、发布 `notes`、产物 URL 与哈希）；打包进去的 `build/update-config.json` 携带 app 从 `process.resourcesPath` 读取的 `feedUrl`（环境变量 `DSH_UPDATE_FEED` 可覆盖，dev 运行永不更新）。`updater.js` 拉取 feed，先按 `buildId` 不一致、再按版本比较判定「新」（同版本热修因此可被检测），按 feed 的 `size` 与 `sha256` 校验下载的 zip，预解压新 bundle，暂存到 `userData/updates`，再交给分离的 apply 脚本——该脚本轮询 app 退出、替换 bundle（保留回滚备份）、重新启动，失败则回滚。`main.js` 负责检查节奏（启动静默检查、显式菜单检查带进度窗口与重启提示、徽标驱动的应用更新），`preload.js` 把 `dsh-update-state` 事件与 apply IPC 桥接进渲染进程。

dist 管线变成一条链：`require-app-not-running.mjs`（过期 bundle 不得与构建竞争）、`stage-runtime.mjs`（通过 `pnpm deploy` 在 `apps/desktop-runtime` 下物化 harness 运行时闭包，并作为 `extraResources` 铺进 `runtime-stage/`）、`gen-icon.mjs`、`electron-builder`、`verify-bundle.mjs`（对产物 app 做冒烟检查）、`make-update-feed.mjs`。`scripts/install-app.mjs` 把当前构建装到本机，供手工通道使用。

## 备选方案

**`electron-updater` / Squirrel.Mac。** 否决：Squirrel.Mac 的更新 feed 需要代码签名构建与签名身份；这个壳刻意不签名发布。

**Sparkle。** 否决：一个 Objective-C 框架外加 appcast 基建，远超「不依赖签名的 feed 加换包」所需，且带有同样的签名形态假设。

**每次启动都重新下载完整 app。** 否决：无条件满带宽下载惩罚每一次启动，而且仍然需要门控逻辑；feed 加哈希的循环就是那道门控，且浪费更少。

**现在引入签名管线。** 推迟：`hardenedRuntime` 保持开启，feed 格式也不排斥未来的签名产物，但签名与公证是一笔 Apple 账号形态的流程成本，这个壳暂不支付。

## 后果

任何打包构建上的用户都能从一份静态 JSON feed 获得原地更新，dev 循环则用指向 dist 目录的 `file://` feed。apply 失败的回滚是恢复上一个 bundle，不触碰用户数据。循环是壳内纯 CommonJS（那里没有 vitest）：钉住它的验证是 `verify-bundle.mjs` 加手工 dev-loop feed，feed 的 notes/artifact/hash 列由生成器产出，而非手工拼装。
