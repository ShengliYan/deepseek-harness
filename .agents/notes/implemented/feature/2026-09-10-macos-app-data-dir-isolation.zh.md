# Agent Note：macOS 壳的 DSH_APP_DATA_DIR 测试隔离模式

Status: implemented

[English](2026-09-10-macos-app-data-dir-isolation.md) | 中文

## 问题

在开发者机器上验收打包桌面端构建（`integration-plan-2026-09-10` §5.3）必须证明 App 能启动真实服务并提供 GUI，且不触碰开发者真实的 `~/.dsh`——包括会话、设置与缓存。把正式 App 指向测试目录启动是不安全的：壳的数据目录取自继承的环境变量，Electron `userData`（连同单实例锁）留在正式位置，主日志写固定路径 `~/Library/Logs`，还会对正式更新源做轮询。

## 决策

壳增加一个测试隔离模式，由单个环境变量选择，并在其它启动步骤之前完成校验。`macos-app/app-data-dir.js` 是纯模块（不引入 Electron），负责解析 `DSH_APP_DATA_DIR`：未设置或为空保持正式模式；设置后必须是已存在的绝对目录，并通过 `realpath` 规范化。它拒绝真实的 `~/.dsh` 本身、其任意子目录、以及它的任意祖先目录（以 `realpath` 作为比较基准，因此指向它的符号链接会被规范化捕获）。校验失败是致命的——`main.js` 弹出错误对话框并退出；该模式绝不静默回退到真实目录。

测试模式下 `main.js` 会：(1) 把服务端口固定为 `13080`（`TEST_MODE_PORT`；端口被占用则停止启动，绝不接管或复用已存在的服务），(2) 把主日志写入隔离目录，(3) 在 `requestSingleInstanceLock` **之前**把 Electron `userData` 重定向到 `<dir>/electron-userdata`，使锁文件与正式 App 的互不相关，(4) 在常规的打包环境清理之后把服务子进程的 `DSH_HOME` 设为隔离目录，(5) 禁用更新：不装轮询定时器、不挂焦点触发、菜单不出现该入口，并在 `checkForUpdates` 顶部加守卫。正式模式（变量未设置）行为不变。

## 备选方案

**Electron 壳加专用 CLI 标志。** 否决：壳没有参数解析；环境变量是它已有的配置通道（`DSH_PORT`、`DSH_REPO_PATH`、`DSH_UPDATE_FEED`），且不需要改动渲染层或 preload。

**目录不存在时自动创建。** 否决：计划要求变量指向已存在的目录；自动创建会掩盖拼写错误，把配置错误变成静默的新数据目录。

**测试模式下接管已存在的监听进程。** 否决：正式的接管行为用于恢复被 detach 的 `dsh web`；测试模式下 `13080` 上的监听者要么是残留的测试服务、要么是别的进程，复用它会让验收测到错误的进程。

## 后果

校验逻辑可用纯 Node 单测（`macos-app/tests/app-data-dir.test.cjs`，`node --test tests/`）：未设置/为空的正式行为、含符号链接规范化的解析、拒绝相对路径、不存在的目录、文件、真实 `~/.dsh`、其子目录、其祖先目录，以及接受其兄弟目录。Electron 侧接线（独立锁、隔离 `userData`、更新禁用）通过开发态启动验证，并在候选构建打包后针对 `13080` 端口重新验证——因为单测无法覆盖锁。仓库根目录的 `start-dsh-web.ps1` 是同一验收的 Windows 侧：它校验参数、固定 Node 版本、以及处于受测提交且干净的检出，然后以 `DSH_HOME` 指向测试目录从源码启动 `dsh web`。
