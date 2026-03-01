// ── SubPlayer Side Panel (Helper / Todo) ────────────────────────────
// This panel no longer does subtitle recognition. It only helps users:
// 1) store page links, and 2) jump into /app with one click.

const TODO_KEY = "todoItems";

let apiBase = "";
let todoItems = [];

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const apiBaseInput = document.getElementById("apiBaseInput");
const saveApiBtn = document.getElementById("saveApiBtn");
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

function normalizeApiBase(input) {
  const value = String(input || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    return new URL(value).toString().replace(/\/+$/, "");
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

function buildPlaylistQuery(currentUrl) {
  const urls = todoItems.map((x) => x.url).filter(Boolean);
  if (!urls.length) return "";
  const idx = Math.max(0, urls.findIndex((u) => u === currentUrl));
  const encoded = btoa(JSON.stringify(urls));
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

async function enqueuePreprocess(url) {
  if (!apiBase) return { ok: false, error: "missing api base" };
  try {
    const res = await fetch(`${apiBase}/api/jobs/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        sourceLang: "auto",
        targetLang: "auto",
      }),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw text for diagnostics
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
      };
    }
    return { ok: !!data?.ok, error: data?.error };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function enqueueAllTodoItems() {
  if (!todoItems.length) return;
  let success = 0;
  let failed = 0;
  let firstError = "";
  for (const item of todoItems) {
    // Sequential enqueue to avoid burst spikes.
    const r = await enqueuePreprocess(item.url);
    if (r.ok) success += 1;
    else {
      failed += 1;
      if (!firstError) firstError = r.error || "unknown error";
    }
  }
  if (failed > 0) {
    setStatus(
      "error",
      `提交完成 ${success}/${todoItems.length}，失败 ${failed}（${firstError.slice(0, 80)}）`,
    );
    return;
  }
  setStatus("active", `已提交预处理任务 ${success}/${todoItems.length}`);
}

function renderTodoList() {
  if (!todoItems.length) {
    todoList.innerHTML = `<div class="empty">还没有保存链接。<br/>在任意视频页点击“保存当前链接”。</div>`;
    return;
  }

  todoList.innerHTML = todoItems
    .map(
      (item) => `
      <div class="item" data-id="${item.id}">
        <div class="item-title">${truncate(item.title || hostOf(item.url), 80)}</div>
        <div class="item-url">${truncate(item.url, 120)}</div>
        <div class="item-meta">${formatTime(item.createdAt)}</div>
        <div class="item-actions">
          <button class="btn btn-primary js-open-app">在 /app 打开</button>
          <button class="btn btn-secondary js-open-src">打开原页</button>
          <button class="btn btn-danger js-delete">删除</button>
        </div>
      </div>
    `,
    )
    .join("");
}

async function loadState() {
  const apiRes = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_API_BASE" }, resolve);
  });
  apiBase = normalizeApiBase(apiRes?.apiBase);
  apiBaseInput.value = apiBase;

  const storage = await readFromStorage(TODO_KEY);
  todoItems = Array.isArray(storage[TODO_KEY]) ? storage[TODO_KEY] : [];
  renderTodoList();
  setStatus("active", "就绪");
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
  setStatus("active", "正在提交预处理任务...");
  await enqueueAllTodoItems();
});

saveCurrentBtn.addEventListener("click", async () => {
  const url = await getPageUrl();
  if (!url) {
    setStatus("error", "无法获取当前页面链接");
    return;
  }

  const exists = todoItems.find((x) => x.url === url);
  if (exists) {
    setStatus("active", "该链接已存在");
    return;
  }

  const item = {
    id: crypto.randomUUID(),
    url,
    title: hostOf(url),
    createdAt: Date.now(),
  };
  todoItems = [item, ...todoItems].slice(0, 200);
  await writeToStorage({ [TODO_KEY]: todoItems });
  renderTodoList();
  setStatus("active", "已保存当前链接");
});

clearBtn.addEventListener("click", async () => {
  todoItems = [];
  await writeToStorage({ [TODO_KEY]: [] });
  renderTodoList();
  setStatus("active", "已清空记录");
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
    await writeToStorage({ [TODO_KEY]: todoItems });
    renderTodoList();
    setStatus("active", "已删除");
  }
});

loadState().catch((err) => {
  setStatus("error", err?.message || "初始化失败");
});
