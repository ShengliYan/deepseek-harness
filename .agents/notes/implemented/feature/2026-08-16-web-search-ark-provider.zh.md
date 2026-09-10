# Agent Note：火山方舟网页搜索 Provider

Status: implemented

[English](2026-08-16-web-search-ark-provider.md) | 中文

## 问题

模型流量跑在火山方舟（Volcengine Ark）上的部署在 harness 的 [web capability seam](../../../../packages/web/web/README.zh.md) 里没有可用的搜索通道：已发布的 provider 覆盖 Exa、Perplexity 和 DeepSeek，因此只有 Ark API key 这一种凭据的部署能跑 agent，却跑不了面向模型的网页搜索工具。Ark 只通过 Responses API 的内置 `web_search` 工具暴露搜索——不存在独立的搜索端点——所以仅靠配置无法让任何既有 provider 指向 Ark。

## 决策

新增实现包 `@deepseek-ai/dsh-web-search-ark`，向 `ctx.web` 注册一个 `WebSearchProvider`（`inject: ['web']`）。一次搜索就是一次完整的 Responses 调用：provider 向 `{baseURL}/responses` 发起携带内置 `web_search` 工具的请求，并把模型的 `message` 输出条目——正文加 `url_citation` 标注——映射为 seam 规范化的 `WebSearchResult`。只有结构化的 `url_citation` 标注会成为结果 URL；绝不从模型正文里抓取链接。搜索由 Ark 在服务端执行，每轮是否搜索由模型自行判断，轮次上限为 `maxToolCalls`。

凭据复用部署已有的 Ark key：引用在每次搜索时通过可选的 `ctx.credentials` seam 解析（`apiKeyEnv`，默认 `ARK_API_KEY`），seam 缺席时回退到启动进程的环境变量，因此在 Models 页面保存或轮换的 key 无需重启即可生效。非空字面量 `apiKey` 优先。`model` 为必填配置；`baseURL` 默认 `https://ark.cn-beijing.volces.com/api/v3`，`sources`/`maxKeyword`/`limit`/`maxToolCalls` 约束检索范围。当存在发起请求的 Agent 会话时，辅助请求会被记录进它的日志。

bundle 以休眠态挂载该 provider：`cordis.patch.yml` 注册 `web-search-ark` 但不挂任何配置，除非部署把 `web.searchProvider` 设为 `ark-official` 并提供 `web-search-ark` 设置节（或在此处给 `baseURL`/`model`/`apiKeyEnv`），否则不会激活。

## 备选方案

**独立的 Ark 搜索端点。** 否决：Ark 没有独立的搜索 API；内置工具是唯一的搜索面，因此 Responses 调用形态就是 provider 本身。

**给既有 provider 加一个 Ark 模式。** 否决：Ark 的线上形态（带工具调用标注的完整 Responses 调用）与其他 provider 调用的专用搜索端点毫无共同之处；每个后端一个 provider，才能让每个包的失败模式与配置词汇保持小。

**从模型正文里抓取 URL。** 否决：正文提取有损且不可验证；只信任 `url_citation` 标注，让每个结果 URL 都由服务端背书。

**把 API key 写死在 cordis.yml 里。** 否决：部署密钥应放在凭据 seam 或环境引用之后；非空字面量仅作为显式覆盖被接受。

## 后果

Ark 部署无需新密钥即可获得面向模型的网页搜索工具。休眠的 bundle 条目在配置前不产生任何成本。一次搜索要花掉完整的一轮模型调用（延迟与 token），模型是否搜索也取决于它在 `maxToolCalls` 轮次内的判断。包内测试钉住 provider 映射、设置校验与凭据缺失失败路径；tool-web 消费方零改动。
