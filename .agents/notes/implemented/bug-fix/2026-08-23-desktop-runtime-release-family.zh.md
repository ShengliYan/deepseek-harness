# Agent Note：桌面部署根并入 dsh release 族

Status: implemented

[English](2026-08-23-desktop-runtime-release-family.md) | 中文

## Problem

`DshFamily.members()` 扫描每个 `apps/*/package.json`，要求 `@deepseek-ai/*` 命名且全族共享一个版本，因此两个偏离族约束的清单会让族校验在任何 release 运行前直接抛错：`apps/desktop-runtime`——由 `macos-app/scripts/stage-runtime.mjs` 再生成的私有 pnpm deploy 根——带着非限定名 `dsh-desktop-runtime-pkg` 和版本 `0.0.1`；而 `packages/web/web-search-ark` 声明的是 `0.1.0-rc.5`，与族基线 `0.1.1-rc.2` 不一致。

## Decision

部署根更名为 `@deepseek-ai/dsh-desktop-runtime`，并且 `stage-runtime.mjs` 从工作区根清单（承载族版本的那份）读取版本，而非硬编码——未来每次 bump 都会流入再生成的清单。已提交的部署根清单副本与生成器现在的输出一致，`web-search-ark` 移到 `0.1.1-rc.2`。`pnpm --filter` 通过生成器写入的同一个常量解析部署根，因此更名不会在清单与其消费方之间漂移。

## Consequences

族校验在当前树上通过（`releaseFamily('dsh').verifyVersions(members())`)，任何 release 步骤都不需要记住这两个清单。未来加在 `apps/` 下的包按构造继承同样的两条要求：限定名、族版本。

## Alternatives considered

**把私有清单或 `apps/desktop-runtime` 从族 glob 中排除。** 否决：扫描正是让每个 app 清单受族规则约束的机制；开例外会让恰恰没有其他门禁覆盖的清单重新依赖人工记忆。

**每次 release 手动 bump 部署根版本。** 否决：它依赖操作者记住一份没有任何其他门禁读取的清单——这正是本次修复消除的失败模式；从根清单派生版本直接删掉了这一步。
