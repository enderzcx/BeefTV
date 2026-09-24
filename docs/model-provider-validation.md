# BeefAPI 模型配置与验收记录

## 本地渠道

- 渠道：`BeefAPI`
- Base URL：`https://enterprise.beefapi.com`
- 协议：OpenAI 兼容
- API Key：仅保存在本机配置，不写入仓库

## 已配置模型

| 能力 | 模型 | 本地协议 | 结果 |
| --- | --- | --- | --- |
| 文本 | `gpt-5.6-sol` | `chat-completion` | 已配置 |
| 视频 | `seedance-2.5` | `newapi` / `POST /v1/videos` | 已配置，预检通过 |
| 视频 | `seedance-2.0-mini` | `newapi` / `POST /v1/videos` | 已配置，预检通过 |
| 视频 | `seedance-2.0` | `newapi` / `POST /v1/videos` | 已配置，预检通过 |
| 视频 | `seedance-2.0-fast` | `newapi` / `POST /v1/videos` | 已配置，预检通过 |
| 视频 | `grok-imagine-video-1.5` | `newapi` / `POST /v1/videos` | 已配置，真实任务完成 |

## 接口验证

- `GET /v1/models`：HTTP 200，返回模型目录。
- 5 个视频模型提交缺少 prompt 的请求：均被上游识别并返回参数校验错误，而不是模型不存在。
- `GET /v1/videos`：HTTP 200。
- 充值后重新查询：`GET /v1/models` 仍没有 image/flux/seedream/dall 类图片模型；`/v1/images/models` 返回“此服务尚未开放”。因此当前渠道没有可配置的图片模型。
- 用视频模型调用 `POST /v1/images/generations` 会被拒绝（`model_price_error`），说明不能把视频模型冒充为图片模型。
- 进一步用 `gpt-image-1`、`dall-e-3`、`flux-1` 做非生成式能力探测，均返回 `model_not_found`（“该模型尚未在企业版开放”），确认不是模型名称遗漏。
- 充值后对 5 个视频模型各提交 1 个最小 4 秒任务，均返回 HTTP 200 并进入队列：
  - `seedance-2.0-mini`：已完成，进度 100%，返回 MP4 content URL。
  - `seedance-2.0-fast`：已完成，进度 100%，返回 MP4 content URL。
  - `grok-imagine-video-1.5`：已完成，进度 100%，返回 MP4 content URL。
  - `seedance-2.5`、`seedance-2.0`：随后轮询完成，进度 100%，返回 MP4 content URL。
- 通过配置的 `https://enterprise.beefapi.com` 基地址访问 `/v1/videos/{task_id}/content` 会正确重定向并下载 MP4；本轮抽样下载 `seedance-2.0-mini` 成功（HTTP 200，约 727 KB，`video/mp4`）。未把媒体文件写入仓库。
- 视频协议定向 Go 测试通过；协议包全量测试另有 3 个支付制品测试因仓库缺少 `plugin-packages/official-payment-*/backend/provider-darwin-arm64` 目录失败，与模型协议无关。
- 前端模型目录专项测试 18/18 通过；全量前端测试基线为 1776 pass、12 fail、1 error，失败项集中在既有画布拖拽、路由加载、资源上传、站点外观和登录页面测试，不涉及 BeefAPI 模型目录或视频协议。
- 模型目录现在保留 OpenAI 兼容 `/models` 返回的 `model_type`、`display_name` 和 `supported_endpoint_types`，具备能力元数据的供应商可自动归类；BeefAPI 当前仍通过本地视频模型补充规则识别 5 个视频模型。

## 当前结论

文本和视频模型已经完成本地配置；视频创建与异步轮询链路已验证可用。图片模型不是余额问题，而是当前 BeefAPI 企业渠道未开放/未提供图片模型，因此暂不添加虚假图片模型配置。媒体下载授权和画布回写仍应在接入真实前端任务流时补做端到端验收。
