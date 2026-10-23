import { invoke } from "@tauri-apps/api/core";
import douyinEmoji from "./douyin-emoji.json";

const emojiByName = new Map<string, string>(Object.entries(douyinEmoji));

type ThemeName = "light" | "dark";
const themeKey = "easy-msg-theme";

function savedTheme(): ThemeName {
  try {
    return localStorage.getItem(themeKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

document.documentElement.dataset.theme = savedTheme();

type PlatformId = "xhs" | "douyin";
type EntryId = "home" | "messages" | "creator";

interface Account {
  bound: boolean;
  nickname: string;
  avatar: string;
  boundAt: number;
  lastSyncAt: number;
  lastError: string;
  messageUrl: string;
  windowOpen: boolean;
}

interface Accounts {
  xhs: Account;
  douyin: Account;
}

interface Conversation {
  id: string;
  title: string;
  preview: string;
  time: string;
  unread: number;
  avatar: string;
  platform: PlatformId;
}

interface ChatMessage {
  id: string;
  text: string;
  fromMe: boolean;
  time: string;
  image?: string;
  pending?: boolean;
  failed?: boolean;
}

interface PendingImage {
  name: string;
  mime: string;
  data: string;
  preview: string;
}

interface SyncResult {
  accounts: Accounts;
  conversations: Conversation[];
  url: string;
  loggedIn: boolean;
  warning: string;
}

interface ThreadResult {
  accounts: Accounts;
  messages: ChatMessage[];
  warning: string;
  textSent?: boolean;
  imageSent?: boolean;
}

const text = {
  app: "\u6613\u8baf",
  xhs: "\u5c0f\u7ea2\u4e66",
  douyin: "\u6296\u97f3",
  bind: "\u626b\u7801\u7ed1\u5b9a",
  done: "\u5df2\u626b\u7801",
  force: "\u7a97\u53e3\u91cc\u5df2\u767b\u5f55",
  open: "\u6253\u5f00",
  sync: "\u540c\u6b65",
  syncAll: "\u540c\u6b65\u5168\u90e8",
  send: "\u53d1\u9001",
  all: "\u5168\u90e8",
  unbound: "\u672a\u7ed1\u5b9a",
  dm: "\u79c1\u4fe1",
  empty: "\u6682\u65e0\u4f1a\u8bdd",
  search: "\u641c\u7d22",
  compose: "\u8f93\u5165\u6d88\u606f",
  relogin: "\u91cd\u65b0\u767b\u5f55",
  windowOn: "\u7a97\u53e3\u5df2\u5f00",
  theme: "\u914d\u8272",
  light: "\u4eae\u8272",
  dark: "\u6697\u8272",
  emoji: "\u8868\u60c5",
  picture: "\u56fe\u7247",
  remove: "\u79fb\u9664",
  pictureText: "[\u56fe\u7247]",
  sending: "\u53d1\u9001\u4e2d",
  sendFailed: "\u6ca1\u53d1\u51fa\u53bb",
  tooBig: "\u56fe\u7247\u4e0d\u80fd\u8d85\u8fc7 8MB",
  badImage: "\u53ea\u80fd\u53d1\u9001\u56fe\u7247",
};

const platforms: Array<{ id: PlatformId; name: string }> = [
  { id: "xhs", name: text.xhs },
  { id: "douyin", name: text.douyin },
];

const state: {
  accounts: Accounts | null;
  conversations: Conversation[];
  messages: ChatMessage[];
  activeKey: string;
  filter: "all" | PlatformId;
  query: string;
  busy: boolean;
  sending: boolean;
  status: string;
  threadWarning: string;
} = {
  accounts: null,
  conversations: [],
  messages: [],
  activeKey: "",
  filter: "all",
  query: "",
  busy: false,
  sending: false,
  status: "",
  threadWarning: "",
};

const app = document.querySelector("#app");
if (!app) throw new Error("missing app");

const shell = el("div", "app");
const accountPane = el("aside", "pane accounts");
const listPane = el("section", "pane list-pane");
const threadPane = el("section", "pane thread-pane");
const accountList = el("div", "account-list");
const footer = el("div", "footer-status");
const listHead = el("div", "list-head");
const search = el("input") as HTMLInputElement;
const filters = el("div", "filters");
const list = el("div", "thread-list");
const threadHead = el("div", "thread-head");
const messages = el("div", "messages");
const composer = el("form", "composer");
const draft = el("textarea") as HTMLTextAreaElement;
const sendButton = el("button", "primary");
const sendSpinner = el("span", "spin");
const sendIcon = icon("send");
const sendLabel = document.createTextNode(text.send);

search.type = "search";
search.placeholder = text.search;
draft.placeholder = text.compose;
sendButton.type = "submit";
sendSpinner.hidden = true;
sendButton.append(sendSpinner, sendIcon, sendLabel);

const brand = el("div", "brand");
const themeSwitch = el("div", "theme-switch");
themeSwitch.setAttribute("role", "group");
themeSwitch.setAttribute("aria-label", text.theme);

function paintTheme(next: ThemeName): void {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(themeKey, next);
  } catch {
    /* private mode */
  }
  for (const button of themeSwitch.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", button.dataset.themeChoice === next ? "true" : "false");
  }
}

for (const item of [
  { id: "light" as const, label: text.light, glyph: "sun" as const },
  { id: "dark" as const, label: text.dark, glyph: "moon" as const },
]) {
  const button = el("button");
  button.type = "button";
  button.dataset.themeChoice = item.id;
  button.title = item.label;
  button.setAttribute("aria-label", item.label);
  button.append(icon(item.glyph));
  button.addEventListener("click", () => paintTheme(item.id));
  themeSwitch.append(button);
}

const mark = el("img", "brand-mark") as HTMLImageElement;
mark.src = "/brand.png";
mark.alt = "";
mark.width = 28;
mark.height = 28;
brand.append(mark, el("strong", undefined, text.app), themeSwitch);
paintTheme(savedTheme());
accountPane.append(brand, accountList, footer);
listHead.append(search, filters);
listPane.append(listHead, list);
const composerBar = el("div", "composer-bar");
const emojiButton = el("button", "icon-button");
const imageButton = el("button", "icon-button");
const fileInput = el("input", "file-input") as HTMLInputElement;
const attach = el("div", "attach");
const attachImg = el("img") as HTMLImageElement;
const attachRemove = el("button", "icon-button");
const emojiPop = el("div", "emoji-pop");
emojiButton.type = "button";
imageButton.type = "button";
attachRemove.type = "button";
emojiButton.title = text.emoji;
imageButton.title = text.picture;
attachRemove.title = text.remove;
emojiButton.setAttribute("aria-label", text.emoji);
imageButton.setAttribute("aria-label", text.picture);
attachRemove.setAttribute("aria-label", text.remove);
emojiButton.append(icon("smile"));
imageButton.append(icon("image"));
attachRemove.append(icon("x"));
fileInput.type = "file";
fileInput.accept = "image/png,image/jpeg,image/gif,image/webp";
attach.hidden = true;
emojiPop.hidden = true;
attach.append(attachImg, attachRemove);
composerBar.append(emojiButton, imageButton, attach, sendButton);
composer.append(draft, composerBar, emojiPop, fileInput);

let emojiReady = false;
function fillEmojiPop(): void {
  if (emojiReady) return;
  emojiReady = true;
  for (const [name, src] of emojiByName) {
    const button = el("button");
    const image = el("img") as HTMLImageElement;
    button.type = "button";
    button.title = name;
    image.src = src;
    image.alt = name;
    button.append(image);
    button.addEventListener("click", () => {
      const start = draft.selectionStart ?? draft.value.length;
      const end = draft.selectionEnd ?? start;
      draft.setRangeText(name, start, end, "end");
      draft.focus();
      emojiPop.hidden = true;
      refreshSend();
    });
    emojiPop.append(button);
  }
}
emojiPop.addEventListener("mousedown", (event) => event.preventDefault());
emojiButton.addEventListener("click", () => {
  fillEmojiPop();
  emojiPop.hidden = !emojiPop.hidden;
});
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Node)) return;
  if (emojiPop.contains(event.target) || emojiButton.contains(event.target)) return;
  emojiPop.hidden = true;
});
imageButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  if (file) attachImageFile(file);
});
draft.addEventListener("paste", (event) => {
  const image = imageFromClipboard(event.clipboardData);
  if (!image) return;
  event.preventDefault();
  attachImageFile(image);
});
document.addEventListener("paste", (event) => {
  const target = event.target;
  if (target === draft || target === search) return;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const image = imageFromClipboard(event.clipboardData);
  if (!image) return;
  event.preventDefault();
  attachImageFile(image);
});
attachRemove.addEventListener("click", () => {
  pendingImage = null;
  renderAttach();
});
threadPane.append(threadHead, messages, composer);
shell.append(accountPane, listPane, threadPane);
app.append(shell);

for (const item of [{ id: "all" as const, label: text.all }, ...platforms.map((item) => ({ id: item.id, label: item.name }))]) {
  const button = el("button", undefined, item.label);
  button.dataset.filter = item.id;
  button.addEventListener("click", () => {
    state.filter = item.id;
    renderFilters();
    renderList();
  });
  filters.append(button);
}

search.addEventListener("input", () => {
  state.query = search.value.trim().toLowerCase();
  renderList();
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendCurrent();
});

draft.addEventListener("input", () => refreshSend());
draft.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendCurrent();
  }
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, value?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function appendRich(parent: HTMLElement, value: string): void {
  const pattern = /\[([^\[\]\n]{1,16})\]/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(value.slice(cursor, index)));
    const token = match[0];
    const src = emojiByName.get(token);
    if (!src) {
      parent.append(document.createTextNode(token));
    } else {
      const image = el("img", "token-emoji") as HTMLImageElement;
      image.src = src;
      image.alt = token;
      image.title = token;
      image.addEventListener("error", () => image.replaceWith(document.createTextNode(token)));
      parent.append(image);
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) parent.append(document.createTextNode(value.slice(cursor)));
}

function icon(name: "send" | "sync" | "sun" | "moon" | "smile" | "image" | "x"): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const paths: string[] = [];
  if (name === "send") paths.push("m22 2-7 20-4-9-9-4Z", "M22 2 11 13");
  if (name === "sync") paths.push("M21 12a9 9 0 1 1-2.2-5.8", "M21 3v6h-6");
  if (name === "moon") paths.push("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z");
  if (name === "sun") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "4");
    svg.append(circle);
    paths.push("M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41");
  }
  if (name === "smile") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    svg.append(circle);
    paths.push("M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01");
  }
  if (name === "image") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "3");
    rect.setAttribute("y", "3");
    rect.setAttribute("width", "18");
    rect.setAttribute("height", "18");
    rect.setAttribute("rx", "2");
    svg.append(rect);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "9");
    circle.setAttribute("cy", "9");
    circle.setAttribute("r", "2");
    svg.append(circle);
    paths.push("m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21");
  }
  if (name === "x") paths.push("M18 6 6 18", "m6 6 12 12");
  for (const value of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", value);
    svg.append(path);
  }
  return svg;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "\u64cd\u4f5c\u5931\u8d25";
}

function clock(ms: number): string {
  if (!ms) return "";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function keyOf(item: Conversation): string {
  return `${item.platform}:${item.id}`;
}

function activeConversation(): Conversation | undefined {
  return state.conversations.find((item) => keyOf(item) === state.activeKey);
}

let pendingImage: PendingImage | null = null;

function refreshSend(): void {
  sendButton.classList.toggle("sending", state.sending);
  sendSpinner.hidden = !state.sending;
  sendIcon.style.display = state.sending ? "none" : "";
  sendLabel.data = state.sending ? text.sending : text.send;
  sendButton.disabled = state.sending || state.busy || !activeConversation() || (!draft.value.trim() && !pendingImage);
}

function renderAttach(): void {
  const attach = composer.querySelector(".attach") as HTMLElement | null;
  const img = composer.querySelector(".attach img") as HTMLImageElement | null;
  if (!attach || !img) return;
  attach.hidden = !pendingImage;
  img.src = pendingImage ? pendingImage.preview : "";
  refreshSend();
}

function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const files = [...data.files].filter((file) => file.type.startsWith("image/"));
  if (files[0]) return files[0];
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

function attachImageFile(file: File): void {
  void readImage(file).then((image) => {
    pendingImage = image;
    renderAttach();
  }).catch((error) => {
    state.status = errorText(error);
    footer.textContent = state.status;
  });
}
function readImage(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      reject(new Error(text.badImage));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error(text.tooBig));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve({
        name: file.name || "image.png",
        mime: file.type,
        data: comma >= 0 ? result.slice(comma + 1) : result,
        preview: result,
      });
    };
    reader.onerror = () => reject(reader.error || new Error(text.badImage));
    reader.readAsDataURL(file);
  });
}
function setBusy(busy: boolean, status = state.status): void {
  state.busy = busy;
  state.status = status;
  renderAccounts();
  renderThread();
  footer.textContent = status;
  refreshSend();
}

async function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
  if (state.busy) return;
  setBusy(true, label);
  try {
    return await task();
  } catch (error) {
    state.status = errorText(error);
    return;
  } finally {
    state.busy = false;
    renderAccounts();
    renderFilters();
    renderList();
    renderThread();
    footer.textContent = state.status;
    refreshSend();
  }
}

function rememberAccounts(accounts: Accounts): void {
  state.accounts = accounts;
}

async function refreshStatus(): Promise<void> {
  rememberAccounts(await invoke<Accounts>("session_status"));
  renderAccounts();
}

const loginTimers: Partial<Record<PlatformId, number>> = {};

function watchLogin(platform: PlatformId): void {
  window.clearInterval(loginTimers[platform]);
  let tries = 0;
  let running = false;
  loginTimers[platform] = window.setInterval(() => {
    tries += 1;
    if (tries > 40 || state.accounts?.[platform].bound) {
      window.clearInterval(loginTimers[platform]);
      return;
    }
    if (running || state.busy) return;
    running = true;
    void invoke<Accounts>("probe_login", { platform })
      .then(async (accounts) => {
        const became = !state.accounts?.[platform].bound && accounts[platform].bound;
        rememberAccounts(accounts);
        renderAccounts();
        if (!became) return;
        window.clearInterval(loginTimers[platform]);
        await syncOne(platform, false);
        renderList();
        footer.textContent = state.status;
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, 2000);
}

async function openPlatform(platform: PlatformId, entry: EntryId): Promise<void> {
  await run(text.open, async () => {
    rememberAccounts(await invoke<Accounts>("open_platform", { platform, entry, focus: true }));
    state.status = text.windowOn;
  });
  if (entry === "home") watchLogin(platform);
}

async function confirm(platform: PlatformId, force: boolean): Promise<void> {
  await run(text.done, async () => {
    rememberAccounts(await invoke<Accounts>("confirm_login", { platform, force }));
    state.status = state.accounts?.[platform].nickname || text.done;
    await syncOne(platform, false);
  });
}

async function syncOne(platform: PlatformId, interactive: boolean): Promise<void> {
  const result = await invoke<SyncResult>("sync_platform", { platform, interactive });
  rememberAccounts(result.accounts);
  state.conversations = [
    ...state.conversations.filter((item) => item.platform !== platform),
    ...result.conversations,
  ];
  state.status = result.warning || `${platforms.find((item) => item.id === platform)?.name} ${result.conversations.length}`;
}

async function syncPlatform(platform: PlatformId): Promise<void> {
  await run(text.sync, async () => {
    await syncOne(platform, true);
  });
  await followConversationUpdates();
}

async function syncAll(): Promise<void> {
  await run(text.syncAll, async () => {
    for (const platform of platforms) {
      if (state.accounts?.[platform.id].bound) await syncOne(platform.id, false);
    }
  });
  await followConversationUpdates();
}

let threadToken = 0;
let threadRefreshing = false;
let threadRefreshAgain = false;
const seenThreads = new Map<string, string>();

function conversationStamp(item: Conversation): string {
  return item.preview + "\n" + item.time + "\n" + String(item.unread);
}

function consumeConversationChanges(): Conversation[] {
  const changed: Conversation[] = [];
  const live = new Set<string>();
  for (const item of state.conversations) {
    const key = keyOf(item);
    live.add(key);
    const stamp = conversationStamp(item);
    const previous = seenThreads.get(key);
    if (previous !== undefined && previous !== stamp) changed.push(item);
    seenThreads.set(key, stamp);
  }
  for (const key of [...seenThreads.keys()]) {
    if (!live.has(key)) seenThreads.delete(key);
  }
  return changed;
}

const threadStore = "easy-msg-threads";
const threadCache = new Map<string, ChatMessage[]>();
let cacheTimer = 0;

function cacheMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ChatMessage>;
    if (typeof row.id !== "string" || typeof row.text !== "string" || !row.text) continue;
    if (row.id.startsWith("preview-") || row.pending) continue;
    const image = typeof row.image === "string" && row.image.startsWith("https://") ? row.image : undefined;
    messages.push({
      id: row.id,
      text: row.text.slice(0, 2000),
      fromMe: Boolean(row.fromMe),
      time: typeof row.time === "string" ? row.time : "",
      image,
      failed: row.failed ? true : undefined,
    });
  }
  return messages.slice(-40);
}

function readThreadCache(): void {
  try {
    const raw = localStorage.getItem(threadStore);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const messages = cacheMessages(value);
      if (messages.length) threadCache.set(key, messages);
    }
  } catch {
    return;
  }
}

function rememberThread(key: string, messages: ChatMessage[]): void {
  const clean = cacheMessages(messages);
  if (!clean.length) return;
  threadCache.set(key, clean);
  window.clearTimeout(cacheTimer);
  cacheTimer = window.setTimeout(() => {
    const entries = [...threadCache.entries()].slice(-60);
    const payload: Record<string, ChatMessage[]> = {};
    for (const [id, rows] of entries) payload[id] = rows;
    try {
      localStorage.setItem(threadStore, JSON.stringify(payload));
    } catch {
      return;
    }
  }, 200);
}

readThreadCache();

function sameMessages(current: ChatMessage[], next: ChatMessage[]): boolean {
  if (current.length !== next.length) return false;
  return current.every((message, index) => {
    const other = next[index];
    return message.text === other.text && message.fromMe === other.fromMe && message.time === other.time && (message.image || "") === (other.image || "");
  });
}

async function refreshActiveThread(): Promise<void> {
  if (state.busy || state.sending) return;
  if (threadRefreshing) {
    threadRefreshAgain = true;
    return;
  }
  const item = activeConversation();
  if (!item) return;
  const token = threadToken;
  const key = state.activeKey;
  threadRefreshing = true;
  try {
    do {
      threadRefreshAgain = false;
      const result = await invoke<ThreadResult>("load_thread", {
        platform: item.platform,
        id: item.id,
        title: item.title,
      });
      if (token !== threadToken || state.activeKey !== key || state.busy) return;
      rememberAccounts(result.accounts);
      if (!result.messages.length) continue;
      const tail = result.messages[result.messages.length - 1];
      let listDirty = false;
      if (item.preview !== tail.text) {
        item.preview = tail.text;
        listDirty = true;
      }
      if (tail.time && item.time !== tail.time) {
        item.time = tail.time;
        listDirty = true;
      }
      seenThreads.set(key, conversationStamp(item));
      if (sameMessages(state.messages, result.messages)) {
        rememberThread(key, result.messages);
        if (listDirty) renderList();
        continue;
      }
      const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
      state.messages = result.messages;
      rememberThread(key, result.messages);
      state.threadWarning = "";
      if (listDirty) renderList();
      renderThread(distance < 96);
    } while (threadRefreshAgain && !state.busy && token === threadToken && state.activeKey === key);
  } catch {
    return;
  } finally {
    threadRefreshing = false;
  }
}

async function followConversationUpdates(): Promise<void> {
  const changed = consumeConversationChanges();
  if (state.activeKey) {
    await refreshActiveThread();
    return;
  }
  const next = changed.find((item) => item.unread > 0) || changed[0];
  if (next) await loadConversation(next);
}

let switchTimer = 0;

function showConversation(item: Conversation): void {
  const key = keyOf(item);
  const cached = threadCache.get(key);
  state.messages = cached
    ? cached.map((message) => ({ ...message }))
    : item.preview
      ? [{ id: "preview-" + item.id, text: item.preview, fromMe: false, time: item.time }]
      : [];
  state.threadWarning = "";
  state.status = item.title;
  renderList();
  renderThread();
  footer.textContent = state.status;
  refreshSend();
}

async function fetchConversation(item: Conversation, token: number, key: string): Promise<void> {
  if (token !== threadToken || state.activeKey !== key || state.sending) return;
  try {
    const result = await invoke<ThreadResult>("load_thread", {
      platform: item.platform,
      id: item.id,
      title: item.title,
    });
    if (token !== threadToken || state.activeKey !== key || state.sending) return;
    rememberAccounts(result.accounts);
    const live = state.conversations.find((entry) => keyOf(entry) === key) || item;
    const tail = result.messages[result.messages.length - 1];
    let listDirty = false;
    if (tail) {
      if (live.preview !== tail.text) {
        live.preview = tail.text;
        listDirty = true;
      }
      if (tail.time && live.time !== tail.time) {
        live.time = tail.time;
        listDirty = true;
      }
      seenThreads.set(key, conversationStamp(live));
    }
    if (result.messages.length) {
      rememberThread(key, result.messages);
      state.threadWarning = result.warning;
      if (!sameMessages(state.messages, result.messages)) {
        const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
        state.messages = result.messages;
        if (token === threadToken && state.activeKey === key) renderThread(distance < 96);
      }
    } else if (!threadCache.has(key)) {
      state.threadWarning = live.preview ? "" : result.warning;
    }
    state.status = state.threadWarning || live.title;
    if (listDirty && token === threadToken && state.activeKey === key) renderList();
  } catch (error) {
    if (token !== threadToken || state.activeKey !== key) return;
    if (!threadCache.has(key)) {
      state.threadWarning = errorText(error);
      state.status = state.threadWarning;
    }
  }
  if (token === threadToken && state.activeKey === key) {
    footer.textContent = state.status;
    refreshSend();
  }
}

async function loadConversation(item: Conversation): Promise<void> {
  threadToken += 1;
  const token = threadToken;
  const key = keyOf(item);
  state.activeKey = key;
  showConversation(item);
  window.clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => {
    void fetchConversation(item, token, key);
  }, 80);
}

async function sendCurrent(): Promise<void> {
  if (state.sending || state.busy) return;
  threadToken += 1;
  const item = activeConversation();
  const value = draft.value.trim();
  const image = pendingImage;
  if (!item || (!value && !image)) return;
  const key = keyOf(item);
  const localId = "local-" + Date.now();
  const local: ChatMessage = {
    id: localId,
    text: value || text.pictureText,
    fromMe: true,
    time: "",
    pending: true,
    image: image ? image.preview : undefined,
  };
  state.sending = true;
  state.status = text.sending;
  state.messages = [...state.messages, local];
  draft.value = "";
  pendingImage = null;
  renderAttach();
  renderThread();
  footer.textContent = text.sending;
  try {
    const result = await invoke<ThreadResult>("send_message", {
      platform: item.platform,
      id: item.id,
      title: item.title,
      text: value,
      image: image ? { name: image.name, mime: image.mime, data: image.data } : null,
    });
    if (state.activeKey !== key) return;
    rememberAccounts(result.accounts);
    const textOk = !value || Boolean(result.textSent);
    const imageOk = !image || Boolean(result.imageSent);
    const ok = textOk && imageOk;
    const server = result.messages.map((message) => ({ ...message }));
    if (image) {
      for (let index = server.length - 1; index >= 0; index -= 1) {
        const message = server[index];
        if (message.fromMe && message.text.includes("\u56fe\u7247") && !message.image) {
          message.image = image.preview;
          break;
        }
      }
    }
    const echoed = !value || server.some((message) => message.fromMe && message.text.replace(/\s+/g, "") === value.replace(/\s+/g, ""));
    if (server.length && (echoed || !ok)) {
      const kept = echoed || !value ? [] : [{ ...local, pending: false, failed: !ok }];
      state.messages = [...server, ...kept];
    } else {
      state.messages = state.messages.map((message) => message.id === localId ? { ...message, pending: false, failed: !ok } : message);
    }
    if (!ok) {
      if (!draft.value.trim() && value) draft.value = value;
      if (image && !imageOk) pendingImage = image;
      state.threadWarning = result.warning || text.sendFailed;
      state.status = state.threadWarning;
    } else {
      state.threadWarning = result.warning;
      state.status = result.warning;
    }
  } catch (error) {
    if (state.activeKey === key) {
      state.messages = state.messages.map((message) => message.id === localId ? { ...message, pending: false, failed: true } : message);
      if (!draft.value.trim() && value) draft.value = value;
      if (image) pendingImage = image;
      state.threadWarning = errorText(error);
      state.status = state.threadWarning;
    }
  } finally {
    state.sending = false;
    if (state.activeKey === key) {
      renderThread();
      renderAttach();
    }
    footer.textContent = state.status;
    refreshSend();
    if (state.activeKey === key) rememberThread(key, state.messages);
  }
}

function renderAccounts(): void {
  accountList.replaceChildren();
  if (!state.accounts) return;
  for (const platform of platforms) {
    const account = state.accounts[platform.id];
    const box = el("section", `account ${platform.id}`);
    const top = el("div", "account-top");
    if (account.avatar) {
      const image = el("img", "avatar") as HTMLImageElement;
      image.src = account.avatar;
      image.alt = "";
      top.append(image);
    } else {
      top.append(el("div", "letter", platform.name.slice(0, 1)));
    }
    const meta = el("div");
    meta.append(el("div", "name ellipsis", platform.name));
    const who = account.bound ? account.nickname || platform.name : text.unbound;
    const when = account.lastSyncAt ? clock(account.lastSyncAt) : "";
    meta.append(el("div", "sub ellipsis", [who, when].filter(Boolean).join("  ")));
    top.append(meta);
    box.append(top);

    const actions = el("div", "actions");
    if (!account.bound) {
      actions.append(
        actionButton(text.bind, () => void openPlatform(platform.id, "home")),
        actionButton(text.done, () => void confirm(platform.id, false)),
        actionButton(text.force, () => void confirm(platform.id, true)),
      );
    } else {
      actions.append(
        actionButton(text.sync, () => void syncPlatform(platform.id), true),
        actionButton(text.relogin, () => void openPlatform(platform.id, "home")),
        actionButton(text.dm, () => void openPlatform(platform.id, "messages")),
      );
    }
    box.append(actions);
    if (account.lastError) box.append(el("div", "error ellipsis", account.lastError));
    accountList.append(box);
  }
  const syncAllButton = actionButton(text.syncAll, () => void syncAll(), true);
  syncAllButton.classList.add("primary");
  const wrap = el("div", "actions");
  wrap.className = "actions sync-wrap";
  wrap.append(syncAllButton);
  accountList.append(wrap);
}

function actionButton(label: string, onClick: () => void, withSyncIcon = false): HTMLButtonElement {
  const button = el("button");
  if (withSyncIcon) button.append(icon("sync"));
  button.append(document.createTextNode(label));
  button.disabled = state.busy;
  button.addEventListener("click", onClick);
  return button;
}

function renderFilters(): void {
  for (const button of filters.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.filter === state.filter);
    button.disabled = state.busy;
  }
}

function visibleConversations(): Conversation[] {
  return state.conversations.filter((item) => {
    if (state.filter !== "all" && item.platform !== state.filter) return false;
    if (!state.query) return true;
    return `${item.title} ${item.preview}`.toLowerCase().includes(state.query);
  });
}

function renderList(): void {
  const rows = visibleConversations();
  list.replaceChildren();
  if (!rows.length) {
    list.append(el("div", "sub", text.empty));
    const empty = list.firstElementChild as HTMLElement;
    empty.classList.add("empty-list");
    return;
  }
  for (const item of rows) {
    const button = el("button", "conversation " + item.platform);
    if (keyOf(item) === state.activeKey) button.classList.add("selected");
    if (item.avatar) {
      const image = el("img", "avatar") as HTMLImageElement;
      image.src = item.avatar;
      image.alt = "";
      button.append(image);
    } else {
      button.append(el("div", "letter", item.title.slice(0, 1)));
    }
    const body = el("div");
    const title = el("div", "name ellipsis", item.title);
    const tag = el("span", `tag ${item.platform}`, item.platform === "xhs" ? text.xhs : text.douyin);
    const titleRow = el("div", "title-row");
    titleRow.append(tag, title);
    const preview = el("div", "preview ellipsis");
    appendRich(preview, item.preview);
    body.append(titleRow, preview);
    button.append(body);
    const side = el("div");
    side.append(el("div", "time", item.time));
    if (item.unread) side.append(el("div", "unread", String(item.unread)));
    button.append(side);
    button.addEventListener("click", () => void loadConversation(item));
    list.append(button);
  }
}

function renderThread(stickToEnd = true): void {
  const item = activeConversation();
  const previousTop = messages.scrollTop;
  threadHead.replaceChildren();
  if (!item) {
    messages.replaceChildren();
    refreshSend();
    return;
  }
  const tag = el("span", `tag ${item.platform}`, item.platform === "xhs" ? text.xhs : text.douyin);
  const title = el("div");
  title.append(el("div", "name ellipsis", item.title));
  if (state.threadWarning) title.append(el("div", "error ellipsis", state.threadWarning));
  threadHead.append(tag, title);
  messages.replaceChildren();
  for (const message of state.messages) {
    const bubble = el("div", message.fromMe ? "bubble mine" : "bubble");
    if (message.pending) bubble.classList.add("pending");
    if (message.failed) bubble.classList.add("failed");
    const showText = message.text && !(message.image && message.text === text.pictureText);
    if (message.image) {
      const shot = el("img", "shot") as HTMLImageElement;
      shot.src = message.image;
      shot.alt = "";
      shot.addEventListener("error", () => {
        shot.remove();
        if (!bubble.textContent) bubble.prepend(document.createTextNode(message.text || text.pictureText));
      });
      bubble.append(shot);
    }
    if (showText || !message.image) appendRich(bubble, message.text);
    if (message.pending) bubble.append(el("span", "time", text.sending));
    else if (message.failed) bubble.append(el("span", "time", text.sendFailed));
    else if (message.time) bubble.append(el("span", "time", message.time));
    messages.append(bubble);
  }
  messages.scrollTop = stickToEnd ? messages.scrollHeight : previousTop;
  refreshSend();
}

async function syncBound(): Promise<void> {
  if (!state.accounts) return;
  const bound = platforms.filter((item) => state.accounts?.[item.id].bound);
  if (!bound.length) return;
  await run(text.sync, async () => {
    for (const platform of bound) await syncOne(platform.id, false);
  });
  await followConversationUpdates();
}

async function recoverLogins(): Promise<void> {
  if (!state.accounts) return;
  for (const platform of platforms) {
    if (state.accounts[platform.id].bound) continue;
    try {
      const accounts = await invoke<Accounts>("probe_login", { platform: platform.id });
      const became = !state.accounts[platform.id].bound && accounts[platform.id].bound;
      rememberAccounts(accounts);
      renderAccounts();
      if (became) await syncOne(platform.id, false);
    } catch {
      continue;
    }
  }
  renderList();
}

void refreshStatus()
  .then(() => recoverLogins())
  .then(() => syncBound())
  .catch((error) => {
    footer.textContent = errorText(error);
  });

window.setInterval(() => {
  void syncBound();
}, 60000);

window.setInterval(() => {
  void refreshActiveThread();
}, 15000);

window.addEventListener("focus", () => {
  void refreshActiveThread();
});

renderFilters();
