# SubPlayer — AI 视频字幕识别与翻译

> 上传视频或粘贴 YouTube 链接，AI 自动生成带时间轴的双语字幕，支持视频内嵌字幕播放。

## 功能特性

- **多种输入方式** — 本地文件上传（拖拽 / 点击）、URL 粘贴（YouTube / 直链视频）
- **YouTube 原生字幕优先** — 自动提取 YouTube 视频已有字幕，避免不必要的 ASR 消耗
- **跨站视频代理播放** — 非 YouTube 链接统一走 Gateway `/api/video/*` 代理，支持 `Range` 拖拽与进度跳转
- **视频内嵌字幕播放** — YouTube 通过 IFrame API 嵌入，其他视频通过 HTML5 `<video>` 播放，字幕实时叠加
- **三模式字幕显示** — 双语（默认）/ 仅原文 / 仅译文，视频叠层与字幕面板同步切换
- **三轨字幕管线** — 原始时间轴轨（source）+ 翻译轨（translation）+ 可读显示轨（readable block）
- **目标语言可选** — 提交任务时可选择翻译目标语言（`auto/zh/en/ja/ko`）
- **长任务控制** — 支持暂停 / 继续 / 停止；URL 任务支持断点恢复
- **播放列表预处理** — 扩展可保存 URL 列表并批量提交预处理，播放页支持连续切换
- **环境能力检测** — 设置页可主动探测本机 ASR 能力（ffmpeg/ffprobe/yt-dlp、本地模型、云端可用性）
- **多 ASR 供应商** — 本地 FunASR / 火山云 STT / 阿里云百炼，支持 fallback 链
- **多引擎翻译** — Gemini / Qwen / DeepSeek，`auto` 默认 Gemini → Qwen fallback
- **字幕导出** — SRT / VTT / TXT / JSON 多格式导出
- **Chrome 扩展** — Side Panel 模式，在任何页面使用字幕功能

## 架构概览

```
客户端                     服务端 (阿里云/腾讯云 + 宝塔面板)
┌──────────────────┐      ┌──────────────────────────────────┐
│  Next.js 前端     │ ──→  │  Nginx 反代 (SSL + 域名)          │
│  (localhost:3000) │      │       ↓                          │
├──────────────────┤      │  API Gateway (Bun + Hono :8080)  │
│  Chrome 扩展      │ ──→  │       ↓              ↓           │
│  (Side Panel)    │      │  ASR 路由          翻译路由       │
└──────────────────┘      │  ├ YouTube字幕提取  ├ Gemini API  │
                          │  ├ ffmpeg音频提取   ├ Qwen API    │
                          │  │                  └ DeepSeek API│
                          │  ├ 本地 FunASR                    │
                          │  ├ 火山云 STT                     │
                          │  └ 阿里云 STT                     │
                          └──────────────────────────────────┘
```

## 项目结构

```
funasr/
├── .env                        # API Keys + 配置 (★ 核心配置文件)
├── Makefile                    # make dev / make build / make deploy
├── ecosystem.config.js         # PM2 进程配置 (宝塔部署)
├── nginx.conf.example          # Nginx 反代配置模板
│
├── apps/
│   ├── web/                    # Next.js 15 前端
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx         # Landing Page
│   │   │   │   └── app/page.tsx     # ★ 主应用 (字幕工作区)
│   │   │   ├── components/
│   │   │   │   ├── VideoPlayer.tsx   # 视频播放 (HTML5 + YouTube IFrame)
│   │   │   │   ├── SubtitlePanel.tsx # 字幕列表面板
│   │   │   │   ├── FileUploadZone.tsx# 文件上传区
│   │   │   │   ├── TaskProgress.tsx  # 任务进度
│   │   │   │   ├── ExportDialog.tsx  # 导出对话框
│   │   │   │   └── ui/              # shadcn/ui 组件库
│   │   │   ├── hooks/
│   │   │   │   └── use-subtitle-sync.ts # 字幕时间轴同步
│   │   │   ├── lib/
│   │   │   │   ├── api.ts           # API 客户端
│   │   │   │   ├── subtitle-export.ts # 字幕导出工具
│   │   │   │   └── utils.ts
│   │   │   └── types/index.ts       # 类型定义
│   │   └── next.config.ts           # API Rewrites → Gateway
│   │
│   └── extension/              # Chrome 扩展 (Manifest V3)
│       ├── manifest.json
│       ├── sidepanel/          # 侧边栏面板
│       ├── content/            # 字幕叠层注入
│       └── background/         # Service Worker
│
└── services/
    ├── gateway/                # ★ API Gateway (Bun + Hono)
    │   └── src/
    │       ├── index.ts        # 入口 + 路由注册
    │       ├── config.ts       # .env 配置加载
    │       ├── providers/      # ASR 供应商抽象层
    │       │   ├── types.ts    #   统一接口定义
    │       │   ├── funasr.ts   #   本地 FunASR
    │       │   ├── volcengine.ts#  火山云 STT
    │       │   ├── aliyun.ts   #   阿里云百炼
    │       │   └── index.ts    #   工厂 + fallback 调度
    │       └── routes/
    │           ├── asr.ts      #   转写路由 (含 YouTube 字幕提取)
    │           ├── translate.ts#   翻译路由 (Gemini / Qwen / DeepSeek)
    │           ├── video.ts    #   视频代理与直链抓流接入
    │           └── jobs.ts     #   预处理任务队列接口
    │
    └── asr/                    # 本地 ASR 微服务 (仅开发环境)
        ├── requirements.txt
        └── app/
            ├── main.py         # FastAPI 入口
            └── services/
                └── asr_engine.py # FunASR 引擎封装
```

## 快速开始

### 环境要求

- **Bun** ≥ 1.0 — [安装](https://bun.sh/)
- **Python** ≥ 3.10 — 仅本地 ASR 需要
- **ffmpeg** — 音频提取 (`brew install ffmpeg`)
- **yt-dlp** — YouTube 视频/字幕下载 (`brew install yt-dlp`)

### 本地开发

```bash
# 1. 安装依赖
make install
# 等同于:
#   cd services/gateway && bun install
#   cd apps/web && bun install

# 2. 配置 .env
# 编辑 .env，填入 GEMINI_API_KEY（推荐）和 ALIYUN_DASHSCOPE_KEY（Qwen 备用）
# DEEPSEEK_API_KEY 为可选手动切换
# 默认 ASR_PROVIDER=local，需要本地 FunASR 服务

# 3. (可选) 设置本地 ASR
make setup-asr
# 创建 .venv 并安装 Python 依赖

# 4. 启动所有服务
make dev
# 并行启动:
#   ASR    → 本地 FunASR (端口 8765，需要 .venv)
#   GW     → API Gateway (端口 8080)
#   WEB    → Next.js 前端 (端口 3000)

# 或分别启动:
make dev-gateway   # 仅网关 (端口 8080)
make dev-web       # 仅前端 (端口 3000)
make dev-asr       # 仅本地 ASR (端口 8765)
```

启动后访问 http://localhost:3000 即可使用。

### 宝塔面板部署 (生产环境)

适用于阿里云 / 腾讯云 ECS 实例，不依赖 Docker。

```bash
# 1. 安装宝塔面板
curl -sSO https://download.bt.cn/install/install_lts.sh && bash install_lts.sh

# 2. 在宝塔面板中安装软件
#    - Nginx（用于反代 + SSL）
#    - PM2 管理器（用于进程守护）

# 3. 安装 Bun 运行时
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# 4. 安装 ffmpeg 和 yt-dlp
yum install -y ffmpeg       # CentOS
# apt install -y ffmpeg     # Ubuntu
pip3 install yt-dlp

# 5. 拉取代码
cd /www/wwwroot
git clone <repo> subplayer
cd subplayer

# 6. 安装 Gateway 依赖
cd services/gateway && bun install && cd ../..

# 7. 配置 .env
#    - ASR_PROVIDER=volcengine (或 aliyun)
#    - 填入对应的 ASR API Key
#    - 填入 GEMINI_API_KEY 和/或 DEEPSEEK_API_KEY
#    - GEMINI_MODEL=gemini-2.0-flash (付费) 或 gemini-2.0-flash-lite (免费)

# 8. PM2 启动 Gateway
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # 开机自启

# 9. 宝塔面板配置
#    - 添加网站 → 绑定域名
#    - SSL → 申请 Let's Encrypt 免费证书
#    - 配置文件 → 参考 nginx.conf.example 添加反代规则

# 10. 前端部署 (二选一)
#    方案 A: 部署到 Vercel (推荐，免费 CDN)
#      cd apps/web && bun run build
#      # 在 Vercel 导入项目
#    方案 B: 同服务器部署
#      cd apps/web && bun run build
#      # 用 PM2 启动 Next 生产服务（不要直接把 .next 当静态目录）
#      cd apps/web && pm2 start "bun run start -- -p 3000" --name subplayer-web
#      # Nginx 将 / 反代到 127.0.0.1:3000，将 /api 反代到 127.0.0.1:8080
```

### Docker 部署说明（当前状态）

- 仓库当前**未内置官方 Dockerfile / docker-compose.yml**。
- 因此 README 不能保证“直接 docker 一键可用”。
- 如需 Docker 化，建议先补齐：
  - `services/gateway/Dockerfile`
  - `apps/web/Dockerfile`
  - 根目录 `docker-compose.yml`
  - `.env.production` 与健康检查脚本

## 配置说明

### `.env` 核心配置

```bash
# ── ASR 供应商 ──────────────────────────────────────
ASR_PROVIDER=local              # local | volcengine | aliyun
# ASR_FALLBACK_CHAIN=volcengine,aliyun,local  # 可选 fallback 链

# ── 翻译引擎 ────────────────────────────────────────
TRANSLATE_PROVIDER=auto         # auto | gemini | qwen | deepseek
GEMINI_MODEL=gemini-2.0-flash   # 付费 key 推荐
# GEMINI_MODEL=gemini-2.0-flash-lite        # 免费 key 推荐
# GEMINI_MODEL=gemini-3-flash-preview       # 最新模型，上下文最大
# GEMINI_MODEL=gemini-flash-lite-latest     # 最新 lite 别名
GEMINI_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here  # 可选，作为 Gemini 的备用

# ── yt-dlp ──────────────────────────────────────────
YT_COOKIES_BROWSER=chrome       # 解决 YouTube 429 限制 (chrome/firefox/safari)
```

### ASR 供应商

| 供应商 | 值 | 用途 | 需要配置 |
|--------|------|------|---------|
| 本地 FunASR | `local` | 开发环境 / GPU 服务器 | ASR_HOST, ASR_PORT |
| 火山云 STT | `volcengine` | 生产环境主力 | VOLCENGINE_APP_ID, ACCESS_TOKEN |
| 阿里云百炼 | `aliyun` | 备用 / 特定语种 | ALIYUN_DASHSCOPE_KEY |

支持 fallback 链: `ASR_FALLBACK_CHAIN=volcengine,aliyun,local`

### 翻译引擎

| 引擎 | 模型 | 特点 |
|------|------|------|
| Gemini | gemini-2.0-flash | 付费 key，速度快，适合长视频 |
| Gemini | gemini-2.0-flash-lite | 免费 key，1000 RPD |
| Gemini | gemini-3-flash-preview | 最新模型，大上下文窗口 |
| Qwen | qwen-max | auto 模式默认备用（依赖阿里云密钥） |
| DeepSeek | deepseek-chat | 可手动切换使用 |

翻译流程优化:
- **批量翻译** — 每 50 段为一批，批次间 1.5s 间隔避免限流
- **单批次重试** — 每批最多重试 3 次（3s, 6s 退避），失败不阻塞后续批次
- **双引擎 fallback** — `auto` 模式下 Gemini 失败自动切换 Qwen

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/asr/transcribe` | POST | 上传文件转写 (multipart/form-data) |
| `/api/asr/transcribe-url` | POST | URL 转写 (YouTube 优先提取原生字幕) |
| `/api/asr/capability` | GET | 检测本机/云端 ASR 可用能力与推荐 provider |
| `/api/asr/providers` | GET | 查看可用 ASR 供应商 |
| `/api/translate/` | POST | 单段翻译 |
| `/api/translate/batch` | POST | 批量翻译 (支持 batch_size 参数) |
| `/api/translate/providers` | GET | 查看翻译引擎状态 |
| `/api/video/prepare` | POST | 解析并准备可播放代理流（含下载回退） |
| `/api/video/prepare-direct` | POST | 使用扩展抓到的直链直接建立代理播放 |
| `/api/video/stream/:token` | GET | 视频代理流（透传 `Range` / 206 / `Content-Range`） |
| `/api/jobs/enqueue` | POST | 提交预处理任务 |
| `/api/jobs/result` | GET | 查询预处理结果 |
| `/api/health` | GET | 健康检查 |

## 近期更新（2026-03）

- **长字幕显示修复**
  - 修复 readable block 索引漂移导致的“高亮错位/卡段”问题。
  - 强化长段切分策略（按时长+字数动态切分），避免字幕长时间停在单段。
- **Pornhub 播放与转写链路优化**
  - Gateway `idleTimeout` 提高到 120s，降低 HLS 片段代理时 `socket hang up` 概率。
  - `transcribe-url` 对 pornhub 站点跳过原生字幕探测，直接进入 ASR。
  - 原生字幕探测加入超时保护（12s），超时立即回退 ASR，减少“无字幕等待”。
- **设置与体验**
  - 字幕/排版配置引入“应用字幕设置”按钮，修改后可立即生效。
  - 输入区新增翻译目标语言选择。
  - 任务支持暂停、继续、停止及 URL 断点恢复。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, Framer Motion |
| 视频 | HTML5 `<video>`, YouTube IFrame API, 实时字幕叠加 |
| 网关 | Bun, Hono, TypeScript |
| ASR | FunASR (本地), 火山云 STT, 阿里云百炼, yt-dlp (YouTube 原生字幕) |
| 翻译 | Gemini / Qwen / DeepSeek（auto: Gemini → Qwen） |
| 媒体 | ffmpeg (音频提取/分片), yt-dlp (视频下载/字幕提取) |
| 部署 | 宝塔面板 + PM2 + Nginx (后端), Vercel (前端, 可选) |
| 扩展 | Chrome Manifest V3, Side Panel API |

## 常见问题

### README 是否“按步骤必定成功”？

不是。当前 README 是“可执行参考”，但以下因素会影响成功率：

1. 第三方站点策略变化（yt-dlp 可用性、Cloudflare、签名过期）
2. 服务器网络与 DNS（尤其是访问 Google/YouTube/CDN）
3. 系统依赖版本（Bun、ffmpeg、yt-dlp、Python）
4. API 配额与密钥权限

建议上线前按以下清单验收：

1. `GET /api/health` 返回 200
2. `GET /api/asr/capability` 返回 `canTranscribe=true` 或有可用云端
3. `POST /api/video/prepare` 可返回 `streamUrl`
4. `POST /api/asr/transcribe-url` 可返回 `segments`
5. `POST /api/translate/batch` 可返回带 `translation` 的段落

### YouTube 链接报 403 / 429 错误

在 `.env` 中设置 `YT_COOKIES_BROWSER=chrome`（或 firefox/safari），让 yt-dlp 使用浏览器 cookie 绕过限制。确保该浏览器已登录 YouTube 账号。

### 翻译报 500 错误（长视频）

1. 确认 `GEMINI_API_KEY` 有效，检查 Google AI Studio 中的配额
2. 切换到更强的模型: `GEMINI_MODEL=gemini-2.0-flash` 或 `gemini-3-flash-preview`
3. 确保配置了 `DEEPSEEK_API_KEY` 作为备用
4. 系统已内置批次重试和引擎 fallback，单次失败通常会自动恢复

### 本地 ASR 连接失败

确认 FunASR 服务已启动: `make dev-asr`，需要先运行 `make setup-asr` 安装 Python 依赖。
