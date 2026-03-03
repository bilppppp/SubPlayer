# SubPlayer

AI 视频字幕识别与翻译工具。支持本地文件和网页链接输入，自动生成时间轴字幕、翻译字幕并进行播放对齐显示。

## 能做什么

- 支持视频/音频文件上传与 URL 输入
- 支持 YouTube / Bilibili / 通用网页视频链接处理
- 支持视频代理播放（含 Range 拖拽、进度跳转）
- 支持实时字幕显示：视频内嵌字幕 + 右侧字幕列表同步高亮
- 支持三种字幕显示模式：双语 / 仅原文 / 仅译文
- 支持可读化分段（长段自动切分，提升观看体验）
- 支持字幕导出：SRT / VTT / TXT / JSON / Markdown
- 支持任务控制：暂停、继续、停止、断点恢复
- 支持播放列表模式与预处理队列
- 支持 Chrome 扩展：保存链接、批量预处理、语言设置、导出
- 支持环境检测：ffmpeg / ffprobe / yt-dlp / 本地或云端 ASR 可用性

## ASR 与翻译

- ASR 提供方
  - 本地 FunASR
  - 火山引擎（支持 `bigmodel_nostream` / `flash`）
  - 阿里云百炼
- 翻译引擎
  - Gemini
  - Qwen
  - DeepSeek
- 支持按配置选择提供方与自动回退策略
- 支持“源语言与目标语言一致时跳过翻译”

## 主要服务

- Web: `apps/web`（Next.js）
- Gateway: `services/gateway`（Bun + Hono）
- Local ASR Service: `services/asr`（FastAPI，可选）
- Chrome Extension: `apps/extension`

## 本地启动

### 依赖

- Bun
- Node.js（用于前端生态命令）
- ffmpeg
- yt-dlp
- Python 3.10+（仅本地 ASR 需要）

### 一键开发

```bash
make install
make setup-asr   # 可选：本地 ASR
make dev
```

默认端口：

- Web: `http://localhost:3000`
- Gateway: `http://localhost:8080`
- ASR: `http://127.0.0.1:8765`（启用本地 ASR 时）

## 生产部署

支持以下方式：

- 后端：ECS + Nginx + PM2（网关）
- 前端：Vercel（推荐）或同机部署 Next.js
- 也可按需要自行容器化部署

## 核心 API

- `POST /api/video/prepare`
- `GET /api/video/stream/:token`
- `POST /api/asr/transcribe`
- `POST /api/asr/transcribe-url`
- `POST /api/asr/transcribe-url-live`
- `GET /api/asr/capability`
- `POST /api/translate/batch`
- `POST /api/jobs/enqueue`
- `GET /api/jobs/status`
- `GET /api/jobs/result`
- `GET /api/health`

## Chrome 扩展

路径：`apps/extension`

可实现：

- 保存当前页面视频链接
- 按条目设置源语言/目标语言
- 批量提交预处理，仅处理新增或未处理条目
- 同步 `/app` 页面配置到扩展
- 预处理状态高亮与进度展示
- 对已完成条目一键导出字幕

## 开源协议

本项目采用 **GPL-3.0** 开源协议。
