# SubPlayer Agent Notes (Current Snapshot)

最后更新：2026-03-01

## 当前实现状态

- 主流程：`输入 URL/文件 -> 准备播放源 -> 字幕获取（原生优先）-> ASR 回退 -> 分段翻译 -> 展示/导出`
- 字幕体系已按三轨运行：
  - `source track`：原始时间轴（ASR 或原生字幕）
  - `translation track`：逐段翻译文本
  - `readable track`：用于显示的可读块（不改变 source track 时间轴）
- UI 已支持：
  - 翻译目标语言选择（`auto/zh/en/ja/ko`）
  - 任务暂停/继续/停止
  - URL 断点恢复
  - 字幕设置“应用”按钮（即时生效）
  - 播放列表与预处理入口（扩展侧）

## 已落地的关键修复

- 修复 readable block 的索引漂移问题，避免高亮错位和“卡在一段不变”。
- 强化长段切分逻辑（按时长+字数动态切分），提升字幕跟随精度。
- 视频代理稳定性提升：
  - `services/gateway/src/index.ts` 将 Bun `idleTimeout` 调整为 `120`。
  - `services/gateway/src/routes/video.ts` 保持 `Range`/`206`/`Content-Range` 透传策略。
- ASR 启动延迟优化：
  - `services/gateway/src/routes/asr.ts` 原生字幕探测加 12s 超时。
  - 对 `pornhub.com` 直接跳过原生字幕探测，立即进入 ASR。

## 当前已知边界

- Cloudflare 强防护站点（例如部分 missav 页面）仅靠 `yt-dlp` 可能失败，需要扩展抓流或浏览器会话方案兜底。
- 某些站点 HLS 会混入广告流，手动候选选择仍可能需要人工判别。
- 首次本地 ASR 可能存在冷启动（模型加载）耗时。

## 运行与排查建议

- 变更网关后务必重启 `gateway`，否则 `idleTimeout` 等配置不生效。
- 若播放出现 `socket hang up`：
  - 先确认 `gateway` 已重启并启用新超时配置。
  - 再观察是否为上游 CDN 抖动（重试一次通常可恢复）。
- 若“无原生字幕等待过长”：
  - 检查日志是否命中 `Native subtitle probe timed out, fallback to ASR`。
  - 确认站点是否已在 `shouldProbeNativeSubtitles` 的跳过名单中。

## 下一步建议（未实现）

- 在任务进度里细分 `字幕探测/音频提取/ASR中/翻译中`，减少“卡住”感知。
- 针对扩展预处理增加任务历史与失败重试策略。
- 为 `missav` 类站点补充可观测日志（候选流评分、命中原因）与灰度策略。
