// ── SubPlayer Side Panel (Helper / Queue) ───────────────────────────
// Features:
// 1) Save links into queue.
// 2) Per-item source/target language.
// 3) Batch preprocess with progress polling.
// 4) Sync browser /app settings (ASR provider keys) into extension.

const TODO_KEY = "todoItems";
const BROWSER_SETTINGS_KEY = "browserSettings";

const LANG_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "es", label: "西语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "ru", label: "俄语" },
];

const EXPORT_FORMATS = [
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
  { value: "json", label: "JSON" },
  { value: "md", label: "Markdown" },
  { value: "txt", label: "TXT" },
];

let apiBase = "";
let todoItems = [];
let browserSettings = null;
let pollingTimer = null;

const jobByItemId = new Map();

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const preprocessSummary = document.getElementById("preprocessSummary");
const apiBaseInput = document.getElementById("apiBaseInput");
const saveApiBtn = document.getElementById("saveApiBtn");
const syncBrowserBtn = document.getElementById("syncBrowserBtn");
const openAppBtn = document.getElementById("openAppBtn");
const saveCurrentBtn = document.getElementById("saveCurrentBtn");
const openQueueBtn = document.getElementById("openQueueBtn");
const preprocessAllBtn = document.getElementById("preprocessAllBtn");
const clearBtn = document.getElementById("clearBtn");
const todoList = document.getElementById("todoList");

function setStatus(state, text) {
  statusDot.className = `status-dot ${state || ""}`.trim();
  statusText.textContent = text;
}

function setSummary(text, level = "") {
  if (!preprocessSummary) return;
  preprocessSummary.textContent = text || "";
  preprocessSummary.className = `preprocess-summary ${level}`.trim();
  if (!text) preprocessSummary.classList.add("hidden");
  else preprocessSummary.classList.remove("hidden");
}

function normalizeApiBase(input) {
  const value = String(input || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeUrl(url) {
  try {
    return new URL(String(url || "")).toString();
  } catch {
    return "";
  }
}

function readFromStorage(key) {
  return new Promise((resolve) => chrome.storage.local.get([key], resolve));
}

function writeToStorage(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

function getPageUrl() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PAGE_URL" }, (res) => {
      resolve(res?.url || "");
    });
  });
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function truncate(text, max = 70) {
  const s = String(text || "");
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function langOptionsHtml(selected) {
  return LANG_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === selected ? "selected" : ""}>${o.label}</option>`).join("");
}

function exportOptionsHtml(selected) {
  return EXPORT_FORMATS.map((o) => `<option value="${o.value}" ${o.value === selected ? "selected" : ""}>${o.label}</option>`).join("");
}

function tsToSrt(seconds) {
  const totalMs = Math.max(0, Math.floor(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function tsToVtt(seconds) {
  return tsToSrt(seconds).replace(",", ".");
}

function toSrt(segments) {
  return segments.map((s, i) => {
    const text = s.translation || s.text || "";
    return `${i + 1}\n${tsToSrt(s.start)} --> ${tsToSrt(s.end)}\n${text}`.trim();
  }).join("\n\n");
}

function toVtt(segments) {
  const body = segments.map((s) => `${tsToVtt(s.start)} --> ${tsToVtt(s.end)}\n${s.translation || s.text || ""}`.trim()).join("\n\n");
  return `WEBVTT\n\n${body}`;
}

function toTxt(segments) {
  return segments.map((s) => s.translation || s.text || "").join("\n");
}

function toMd(segments) {
  const lines = ["# SubPlayer Subtitle Export", ""];
  for (const s of segments) {
    lines.push(`- [${tsToVtt(s.start)} - ${tsToVtt(s.end)}] ${s.translation || s.text || ""}`);
  }
  return lines.join("\n");
}

function toJson(segments, meta = {}) {
  return JSON.stringify({ meta, segments }, null, 2);
}

function triggerDownload(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchJobResult(item) {
  const targetLang = item.targetLang || "auto";
  const url = `${apiBase}/api/jobs/result?url=${encodeURIComponent(item.url)}&targetLang=${encodeURIComponent(targetLang)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.ok || data?.status !== "done" || !data?.result?.segments) {
    throw new Error(data?.error || `任务未完成（${data?.status || "unknown"}）`);
  }
  return data.result;
}

function buildPlaylistQuery(currentUrl) {
  const items = todoItems
    .map((x) => ({
      url: x.url,
      sourceLang: x.sourceLang || "auto",
      targetLang: x.targetLang || "auto",
    }))
    .filter((x) => !!x.url);
  if (!items.length) return "";
  const idx = Math.max(0, items.findIndex((x) => x.url === currentUrl));
  const encoded = btoa(JSON.stringify(items));
  return `&playlist=${encodeURIComponent(encoded)}&idx=${idx}`;
}

function openOrReuseAppTab(appUrl) {
  if (!apiBase) {
    setStatus("error", "请先保存 API 地址");
    return;
  }
  chrome.tabs.query({ url: `${apiBase}/app*` }, (tabs) => {
    const reused = tabs[0];
    if (reused?.id) {
      chrome.tabs.update(reused.id, { url: appUrl, active: true });
      return;
    }
    chrome.tabs.create({ url: appUrl });
  });
}

function openInSubPlayerApp(targetUrl, withPlaylist = false) {
  if (!apiBase) {
    setStatus("error", "请先保存 API 地址");
    return;
  }
  const playlistQuery = withPlaylist ? buildPlaylistQuery(targetUrl) : "";
  const appUrl = `${apiBase}/app?url=${encodeURIComponent(targetUrl)}&autorun=1${playlistQuery}`;
  openOrReuseAppTab(appUrl);
}

function effectiveApiKeys() {
  return browserSettings?.apiKeys || {};
}

function hasCloudAsrConfigured() {
  const k = effectiveApiKeys();
  return Boolean(
    (k.asrProvider === "volcengine" && k.volcengineAppId && k.volcengineToken)
    || (k.asrProvider === "aliyun" && k.aliyunKey),
  );
}

async function enqueuePreprocess(item) {
  if (!apiBase) return { ok: false, error: "missing api base" };
  try {
    const res = await fetch(`${apiBase}/api/jobs/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: item.url,
        sourceLang: item.sourceLang || "auto",
        targetLang: item.targetLang || "auto",
        apiKeys: effectiveApiKeys(),
      }),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
      };
    }

    return {
      ok: !!data?.ok,
      error: data?.error,
      key: data?.key,
      status: data?.job?.status,
      progress: Number(data?.job?.progress || 0),
      step: data?.job?.step || "queued",
      message: data?.job?.message || "等待处理",
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function fetchStatusesByTargetLang(items, targetLang) {
  const urls = items.map((x) => x.url);
  try {
    const res = await fetch(`${apiBase}/api/jobs/status-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, targetLang }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.statuses) ? data.statuses : [];
  } catch {
    return [];
  }
}

async function pollJobStatuses() {
  if (!apiBase || todoItems.length === 0) return;

  const groups = new Map();
  for (const item of todoItems) {
    const key = item.targetLang || "auto";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const [targetLang, items] of groups.entries()) {
    const statuses = await fetchStatusesByTargetLang(items, targetLang);
    const statusByUrl = new Map();
    for (const s of statuses) {
      statusByUrl.set(normalizeUrl(s.url), s);
    }

    for (const item of items) {
      const st = statusByUrl.get(normalizeUrl(item.url));
      if (!st) continue;
      jobByItemId.set(item.id, {
        status: st.status,
        progress: Number(st.progress || 0),
        step: st.step || "queued",
        message: st.message || "",
        error: st.error || "",
        hasResult: !!st.hasResult,
        updatedAt: st.updatedAt || Date.now(),
      });
    }
  }

  renderTodoList();
  updatePreprocessSummary();
}

function ensurePolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    pollJobStatuses().catch(() => {});
  }, 2000);
}

function stopPollingIfIdle() {
  const states = Array.from(jobByItemId.values());
  const active = states.some((s) => s && (s.status === "queued" || s.status === "processing"));
  if (active) return;
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function updatePreprocessSummary() {
  if (!todoItems.length) {
    setSummary("");
    stopPollingIfIdle();
    return;
  }

  let queued = 0;
  let processing = 0;
  let done = 0;
  let failed = 0;

  for (const item of todoItems) {
    const st = jobByItemId.get(item.id);
    if (!st) continue;
    if (st.status === "queued") queued += 1;
    else if (st.status === "processing") processing += 1;
    else if (st.status === "done") done += 1;
    else if (st.status === "failed") failed += 1;
  }

  const totalTracked = queued + processing + done + failed;
  if (totalTracked === 0) {
    setSummary("");
    stopPollingIfIdle();
    return;
  }

  const txt = `预处理进度：完成 ${done} / ${totalTracked}，处理中 ${processing}，排队 ${queued}，失败 ${failed}`;
  if (failed > 0) setSummary(txt, "error");
  else if (processing > 0 || queued > 0) setSummary(txt, "active");
  else setSummary(`预处理完成：${done}/${totalTracked}`, "done");

  stopPollingIfIdle();
}

function jobBadge(item) {
  const st = jobByItemId.get(item.id);
  if (!st) return `<span class="job-badge">未提交</span>`;

  if (st.status === "done") {
    return `<span class="job-badge done">已完成 ${Math.max(100, st.progress || 100)}%</span>`;
  }
  if (st.status === "failed") {
    return `<span class="job-badge failed">失败</span>`;
  }
  if (st.status === "processing") {
    return `<span class="job-badge processing">处理中 ${Math.max(1, Math.min(99, st.progress || 1))}%</span>`;
  }
  if (st.status === "queued") {
    return `<span class="job-badge queued">排队中</span>`;
  }
  return `<span class="job-badge">${st.status}</span>`;
}

function itemClass(item) {
  const st = jobByItemId.get(item.id);
  if (!st) return "";
  if (st.status === "done") return "item-done";
  if (st.status === "failed") return "item-failed";
  if (st.status === "processing" || st.status === "queued") return "item-processing";
  return "";
}

function renderTodoList() {
  if (!todoItems.length) {
    todoList.innerHTML = `<div class="empty">还没有保存链接。<br/>在任意视频页点击“保存当前链接”。</div>`;
    return;
  }

  todoList.innerHTML = todoItems
    .map((item) => {
      const st = jobByItemId.get(item.id);
      const progressWidth = st ? Math.max(0, Math.min(100, Number(st.progress || 0))) : 0;
      return `
      <div class="item ${itemClass(item)}" data-id="${item.id}">
        <div class="item-head">
          <div class="item-title">${truncate(item.title || hostOf(item.url), 80)}</div>
          ${jobBadge(item)}
        </div>
        <div class="item-url">${truncate(item.url, 120)}</div>
        <div class="item-meta">${formatTime(item.createdAt)} · 源: ${item.sourceLang || "auto"} · 目标: ${item.targetLang || "auto"}</div>
        <div class="item-actions">
          <button class="btn btn-primary js-open-app">在 /app 打开</button>
          <button class="btn btn-secondary js-open-src">打开原页</button>
          <button class="btn btn-danger js-delete">删除</button>
        </div>
        <div class="item-lang-row">
          <div class="lang-field">
            <span class="lang-label">源语言</span>
            <select class="lang-select js-source-lang" title="源语言">${langOptionsHtml(item.sourceLang || "auto")}</select>
          </div>
          <div class="lang-field">
            <span class="lang-label">目标语言</span>
            <select class="lang-select js-target-lang" title="目标语言">${langOptionsHtml(item.targetLang || "auto")}</select>
          </div>
        </div>
        <div class="item-export">
          <select class="lang-select js-export-format" title="导出格式">${exportOptionsHtml(item.exportFormat || "srt")}</select>
          <button class="btn btn-secondary js-export">导出</button>
        </div>
        ${st ? `<div class="item-progress"><div class="item-progress-bar" style="width:${progressWidth}%"></div></div>` : ""}
        ${st?.message ? `<div class="item-job-msg">${truncate(st.message, 120)}${st.error ? ` · ${truncate(st.error, 80)}` : ""}</div>` : ""}
      </div>
    `;
    })
    .join("");
}

async function loadState() {
  const apiRes = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_API_BASE" }, resolve);
  });
  apiBase = normalizeApiBase(apiRes?.apiBase);
  apiBaseInput.value = apiBase;

  const todoStorage = await readFromStorage(TODO_KEY);
  todoItems = Array.isArray(todoStorage[TODO_KEY])
    ? todoStorage[TODO_KEY].map((x) => ({
      ...x,
      sourceLang: x.sourceLang || "auto",
      targetLang: x.targetLang || "auto",
      exportFormat: x.exportFormat || "srt",
    }))
    : [];

  const settingStorage = await readFromStorage(BROWSER_SETTINGS_KEY);
  browserSettings = settingStorage[BROWSER_SETTINGS_KEY] || null;

  renderTodoList();
  updatePreprocessSummary();
  setStatus("active", browserSettings ? "就绪（已同步浏览器设置）" : "就绪（未同步浏览器设置）");
}

async function syncBrowserSettings() {
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_BROWSER_SETTINGS_FROM_ACTIVE_TAB" }, resolve);
  });

  if (!res?.ok) {
    setStatus("error", res?.error || "同步失败：请先打开 /app 页面");
    return;
  }

  const state = res.settings || {};
  const apiKeys = {
    asrProvider: state.asrProvider,
    translateProvider: state.translateProvider,
    volcengineAppId: state.volcengineAppId,
    volcengineToken: state.volcengineToken,
    volcengineSecretKey: state.volcengineSecretKey,
    volcengineMode: state.volcengineMode,
    allowAsrAutoDowngrade: state.allowAsrAutoDowngrade,
    aliyunKey: state.aliyunKey,
    geminiKey: state.geminiKey,
    deepseekKey: state.deepseekKey,
  };

  browserSettings = {
    syncedAt: Date.now(),
    apiKeys,
    source: res.source || "active-tab",
  };
  await writeToStorage({ [BROWSER_SETTINGS_KEY]: browserSettings });

  setStatus("active", `已同步浏览器设置（ASR: ${apiKeys.asrProvider || "auto"}）`);
}

saveApiBtn.addEventListener("click", () => {
  const normalized = normalizeApiBase(apiBaseInput.value);
  if (!normalized) {
    setStatus("error", "API 地址格式不正确");
    return;
  }

  chrome.runtime.sendMessage({ type: "SET_API_BASE", apiBase: normalized }, (res) => {
    if (!res?.ok) {
      setStatus("error", "保存失败");
      return;
    }
    apiBase = normalized;
    apiBaseInput.value = apiBase;
    setStatus("active", "API 地址已保存");
  });
});

syncBrowserBtn?.addEventListener("click", async () => {
  await syncBrowserSettings();
});

openAppBtn.addEventListener("click", async () => {
  const url = await getPageUrl();
  if (!url) {
    setStatus("error", "无法获取当前页面链接");
    return;
  }
  openInSubPlayerApp(url, true);
  setStatus("active", "已在 /app 打开当前链接");
});

openQueueBtn?.addEventListener("click", () => {
  const first = todoItems[0]?.url;
  if (!first) {
    setStatus("error", "列表为空，请先保存链接");
    return;
  }
  openInSubPlayerApp(first, true);
  setStatus("active", "已在同一页面打开播放列表");
});

preprocessAllBtn?.addEventListener("click", async () => {
  if (!todoItems.length) {
    setStatus("error", "列表为空，请先保存链接");
    return;
  }
  if (!hasCloudAsrConfigured()) {
    setStatus("error", "请先点“同步浏览器设置”，确保使用云端 ASR 配置");
    return;
  }

  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  let firstError = "";

  setStatus("active", "正在提交预处理任务...");
  // Refresh latest job state first, then only enqueue truly new/unprocessed items.
  await pollJobStatuses();
  for (const item of todoItems) {
    const st = jobByItemId.get(item.id);
    if (st && (st.status === "done" || st.status === "queued" || st.status === "processing")) {
      skipped += 1;
      continue;
    }

    const r = await enqueuePreprocess(item);
    if (r.ok) {
      submitted += 1;
      jobByItemId.set(item.id, {
        status: r.status || "queued",
        progress: Number(r.progress || 0),
        step: r.step || "queued",
        message: r.message || "等待处理",
        error: "",
        key: r.key,
      });
    } else {
      failed += 1;
      if (!firstError) firstError = r.error || "unknown";
      jobByItemId.set(item.id, {
        status: "failed",
        progress: 0,
        step: "failed",
        message: "提交失败",
        error: r.error || "unknown",
      });
    }
  }

  renderTodoList();
  ensurePolling();
  await pollJobStatuses();

  if (failed > 0) {
    setStatus("error", `已提交 ${submitted}，跳过 ${skipped}，失败 ${failed}`);
    setSummary(`提交失败 ${failed} 项：${truncate(firstError, 90)}`, "error");
  } else {
    setStatus("active", `已提交 ${submitted}，跳过 ${skipped}（已处理/处理中）`);
  }
});

saveCurrentBtn.addEventListener("click", async () => {
  const url = await getPageUrl();
  if (!url) {
    setStatus("error", "无法获取当前页面链接");
    return;
  }

  const normalized = normalizeUrl(url);
  const exists = todoItems.find((x) => normalizeUrl(x.url) === normalized);
  if (exists) {
    setStatus("active", "该链接已存在");
    return;
  }

  const item = {
    id: crypto.randomUUID(),
    url,
    title: hostOf(url),
    createdAt: Date.now(),
    sourceLang: "auto",
    targetLang: "auto",
    exportFormat: "srt",
  };
  todoItems = [item, ...todoItems].slice(0, 200);
  await writeToStorage({ [TODO_KEY]: todoItems });
  renderTodoList();
  setStatus("active", "已保存当前链接");
});

clearBtn.addEventListener("click", async () => {
  todoItems = [];
  jobByItemId.clear();
  await writeToStorage({ [TODO_KEY]: [] });
  renderTodoList();
  updatePreprocessSummary();
  setStatus("active", "已清空记录");
});

todoList.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const card = target.closest(".item");
  const id = card?.getAttribute("data-id");
  if (!id) return;
  const idx = todoItems.findIndex((x) => x.id === id);
  if (idx < 0) return;

  if (target.classList.contains("js-source-lang")) {
    const val = target.value || "auto";
    todoItems[idx].sourceLang = val;
    await writeToStorage({ [TODO_KEY]: todoItems });
    renderTodoList();
    return;
  }

  if (target.classList.contains("js-target-lang")) {
    const val = target.value || "auto";
    todoItems[idx].targetLang = val;
    await writeToStorage({ [TODO_KEY]: todoItems });
    renderTodoList();
    return;
  }

  if (target.classList.contains("js-export-format")) {
    const val = target.value || "srt";
    todoItems[idx].exportFormat = val;
    await writeToStorage({ [TODO_KEY]: todoItems });
    renderTodoList();
  }
});

todoList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const card = target.closest(".item");
  const id = card?.getAttribute("data-id");
  if (!id) return;
  const item = todoItems.find((x) => x.id === id);
  if (!item) return;

  if (target.classList.contains("js-open-app")) {
    openInSubPlayerApp(item.url, true);
    setStatus("active", "已在 /app 打开播放列表");
    return;
  }

  if (target.classList.contains("js-open-src")) {
    chrome.tabs.create({ url: item.url });
    setStatus("active", "已打开原页面");
    return;
  }

  if (target.classList.contains("js-delete")) {
    todoItems = todoItems.filter((x) => x.id !== id);
    jobByItemId.delete(id);
    await writeToStorage({ [TODO_KEY]: todoItems });
    renderTodoList();
    updatePreprocessSummary();
    setStatus("active", "已删除");
    return;
  }

  if (target.classList.contains("js-export")) {
    if (!apiBase) {
      setStatus("error", "请先保存 API 地址");
      return;
    }
    try {
      setStatus("active", "正在导出...");
      const result = await fetchJobResult(item);
      const segments = Array.isArray(result.segments) ? result.segments : [];
      if (!segments.length) throw new Error("没有可导出的字幕");

      const fmt = item.exportFormat || "srt";
      const host = hostOf(item.url).replace(/[^a-zA-Z0-9.-]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = `subplayer-${host}-${stamp}`;

      if (fmt === "srt") triggerDownload(`${base}.srt`, toSrt(segments), "application/x-subrip;charset=utf-8");
      else if (fmt === "vtt") triggerDownload(`${base}.vtt`, toVtt(segments), "text/vtt;charset=utf-8");
      else if (fmt === "json") triggerDownload(`${base}.json`, toJson(segments, { url: item.url, targetLang: item.targetLang || "auto" }), "application/json;charset=utf-8");
      else if (fmt === "md") triggerDownload(`${base}.md`, toMd(segments), "text/markdown;charset=utf-8");
      else triggerDownload(`${base}.txt`, toTxt(segments), "text/plain;charset=utf-8");

      setStatus("active", `导出成功（${fmt.toUpperCase()}）`);
    } catch (err) {
      setStatus("error", `导出失败：${err?.message || "unknown"}`);
    }
  }
});

loadState().then(() => {
  // On open, do one status refresh for existing queue.
  pollJobStatuses().catch(() => {});
  ensurePolling();
}).catch((err) => {
  setStatus("error", err?.message || "初始化失败");
});
