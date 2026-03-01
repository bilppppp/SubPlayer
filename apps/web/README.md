# SubPlayer Web App (`apps/web`)

Next.js 前端应用，负责：

- URL/文件提交与任务编排
- 视频播放（YouTube IFrame / HTML5）
- 三轨字幕显示（source / translation / readable）
- 导出与设置（字体、高亮、可读分段参数）

## 开发启动

```bash
cd apps/web
bun install
bun dev
```

默认访问：`http://localhost:3000`

## 依赖服务

- Gateway：`http://localhost:8080`（默认）
- 重写规则：`/api/* -> ${NEXT_PUBLIC_GATEWAY_URL || http://localhost:8080}/api/*`

在 `apps/web/next.config.ts` 中配置。

## 关键页面

- `src/app/page.tsx`：入口页
- `src/app/app/page.tsx`：主工作区（任务流、播放、字幕面板）

## 当前能力（与主 README 对齐）

- 输入：URL / 本地文件
- 目标翻译语言选择：`auto/zh/en/ja/ko`
- 任务控制：暂停 / 继续 / 停止
- URL 任务断点恢复
- 播放列表模式（含预处理结果读取）
- 字幕设置“应用”按钮（修改后立即生效）

## 字幕机制（前端侧）

- `source track`：原始时间轴字幕（原生字幕或 ASR）
- `translation track`：逐段翻译结果
- `readable track`：仅用于展示的可读块，不改 source 时间轴

说明：
- 视频嵌字跟随 `activeSegment`（时间轴实时）
- 右侧面板在 readable 模式下展示合并块，同时保留对 source 时间轴的高亮定位

## 调试建议

- 若 `/api/*` 请求异常，先确认 Gateway 是否启动。
- 若长任务报超时，确认 Next `experimental.proxyTimeout` 未被改小。
- 若字幕高亮错位，优先检查是否使用了最新 `resegment` 逻辑（已修复索引漂移）。
