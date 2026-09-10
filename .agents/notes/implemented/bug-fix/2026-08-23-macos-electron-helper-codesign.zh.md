# Agent Note: 未签名 Mac 应用的 Helper 在重命名后必须做 adhoc 签名

Status: implemented

[English](2026-08-23-macos-electron-helper-codesign.md) | 中文

## Problem

electron-builder 在 `identity: null` 时，把 GPU/renderer helper 重命名为 DeepSeek Harness 后，其代码签名仍是 `Electron Helper`。macOS 15 的 code-signing monitor 会在启动时对这些 helper 发出 SIGTRAP（`EXC_BREAKPOINT`，`codeSigningID` 仍为 `Electron Helper (GPU)`）。Electron 壳随后在数秒内退出，而 detached 的 `dsh web` 子进程被 PID 1 收养并继续占用 3080。用户看到的是该端口上的浏览器标签，或 "Failed to load plugins"，而不是 Mac 窗口。

第二条致命路径是打包后的 `main.js` 出现 SyntaxError。Electron 把该文件当作进程入口求值；解析失败会在 `process.on` 和启动日志之前退出，因此 `dsh web --no-open` 根本不会启动，3080 上残留的 Safari 标签看起来就像产品本身。1549 构建带上了这个缺陷：`loadAppUrl` 后面残留的 `createWindow` 尾部让 `node --check macos-app/main.js` 失败。从该标签访问时，loopback 的 settings 写入会打到正在退出或尚未启动完成的 Host，内测声明就会报 "暂时无法保存确认状态，请重试。"

## Decision

`afterPack` 对解包后的 `.app` 做 adhoc 签名（`codesign --force --deep --sign -`），并使用 `build/entitlements.mac.plist`（`disable-library-validation`、JIT、unsigned executable memory）。未签名的本地构建将 `hardenedRuntime` 设为 `false`。Info.plist 的 `LSEnvironment` 设置 `ELECTRON_DISABLE_GPU=1`，让 Chromium 在执行 JavaScript 之前就看到该 flag；壳进程仍传入 `--disable-gpu` / `--in-process-gpu`，打包后的 Darwin 构建还会传入 `--no-sandbox`，因为 adhoc 签名的 helper 在 Chromium sandbox 下仍会 SIGTRAP（`codeSigningMonitor: 2`）。壳进程在 `startServer` 之前先创建窗口，并以 `dsh web --no-open` 拉起服务。3080 上残留的本应用监听进程会被接管，而不是当成外来占用。同源 `window.open` 直接拒绝且不调用 `openExternal`，因此应用 origin 不会落到 Safari。打包后的 spawn 会丢掉继承来的 `DSH_HOME` / `DSH_SMOKE_PORT`，避免 smoke 或 agent shell 把 GUI 指到 `/tmp/dsh-*` 而不是 `~/.dsh`。`electron-builder.mjs` 在打包前对 `main.js` 跑 `node --check`，`verify-bundle.mjs` 再从 `app.asar` 抽出打包后的 `main.js` 检查一次。

## Consequences

在 macOS 15 上，dist 构建必须经过 `afterPack` 签名才能启动。改 helper 名称或去掉 entitlements 会让 SIGTRAP 回来。不带 `--no-open` 的 `dsh web` 仍会打开系统浏览器；本包装器必须带上该 flag。`main.js` 的 SyntaxError 会让 dist 脚本失败，而不是发出一个无法启动的应用。

## Alternatives considered

**只在 `main.js` 里关闭 GPU（`app.disableHardwareAcceleration()`）。** 不足以作为完整方案：Chromium 仍会在该行执行之前拉起 GPU helper；1542 仍然对 `Electron Helper (GPU)` 发生 SIGTRAP。

**把孤儿 `dsh web` 当成产品 UI。** 拒绝：Mac 包装器的职责是拥有窗口，并在退出时结束服务；PID 1 上的 node 加一个 Safari 标签正是本次要去掉的失败形态。

**只靠手工点开应用、不做 `node --check`。** 拒绝：1549 已经证明 SyntaxError 会留下空启动日志和浏览器标签，在解析 asar 之前看起来和 GPU SIGTRAP 一样。

**把启动环境里的 `DSH_HOME` 原样传给打包后的 `dsh web`。** 拒绝：从 smoke 或 agent shell 执行 `open` 会泄漏 `/tmp/dsh-plugin-smoke-*`，于是 `settings.describe` 返回空的 `ui-onboarding`，而 `~/.dsh/settings.yaml` 里已经有确认记录；写入已被删除的临时目录就会报「暂时无法保存确认状态」。开发态 `electron .` 仍会转发 `DSH_HOME`。
