# 本地模型配置持久化

本地桌面模式的模型渠道不再只依赖浏览器 `localStorage`。前端启动时通过 `/api/workspace/model-config` 读取本机快照，渠道发生变化后自动保存；后端将快照原子写入 BeefTV 应用数据目录的 `local-model-config.json`。

- 配置文件位于应用数据目录，不进入 Git，也不随前端静态资源更新覆盖。
- 写入采用临时文件 + `rename`，文件权限为 `0600`，目录权限为 `0700`。
- 当前本机已预置 BeefAPI 文本模型 `gpt-5.6-sol` 和视频模型：`seedance-2.5`、`seedance-2.0-mini`、`seedance-2.0`、`seedance-2.0-fast`、`grok-imagine-video-1.5`。
- API Key 只保存在本机配置文件中，不应提交到仓库或日志。

首次使用新桌面构建时，如果旧版本仍有浏览器渠道配置，前端会自动迁移到本地快照；后续重装前端资源不会清除模型配置。
