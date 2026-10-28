import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
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
  id: string;
  platform: PlatformId;
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
  accounts: Account[];
}

interface Conversation {
  id: string;
  title: string;
  preview: string;
  time: string;
  unread: number;
  avatar: string;
  platform: PlatformId;
  accountId?: string;
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
  notifyOn: "\u901a\u77e5\u5df2\u5f00\u542f",
  notifyOff: "\u901a\u77e5\u5df2\u5173\u95ed",
  newMessage: "\u65b0\u6d88\u606f",
  hide: "\u9690\u85cf",
  unhide: "\u6062\u590d",
  deleteChat: "\u5220\u9664",
  hidden: "\u9690\u85cf",
  hiddenEmpty: "\u6ca1\u6709\u9690\u85cf\u7684\u5bf9\u8bdd",
  addAccount: "\u6dfb\u52a0\u8d26\u53f7",
  removeAccount: "\u79fb\u9664\u8d26\u53f7",
  loading: "\u6b63\u5728\u540c\u6b65\u4f1a\u8bdd",
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
  filter: "all" | PlatformId | "hidden";
  accountFilter: string;
  query: string;
  busy: boolean;
  booting: boolean;
  sending: boolean;
  status: string;
  threadWarning: string;
} = {
  accounts: null,
  conversations: [],
  messages: [],
  activeKey: "",
  filter: "all",
  accountFilter: "",
  query: "",
  busy: false,
  booting: true,
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
const notifyKey = "easy-msg-notify";
const notifyButton = el("button", "icon-button notify-toggle");
notifyButton.type = "button";

function noticesEnabled(): boolean {
  try {
    return localStorage.getItem(notifyKey) !== "off";
  } catch {
    return true;
  }
}

function paintNotify(): void {
  const on = noticesEnabled();
  notifyButton.replaceChildren(icon(on ? "bell" : "bell-off"));
  notifyButton.setAttribute("aria-pressed", on ? "true" : "false");
  notifyButton.title = on ? text.notifyOn : text.notifyOff;
  notifyButton.setAttribute("aria-label", notifyButton.title);
}

notifyButton.addEventListener("click", () => {
  const turningOn = !noticesEnabled();
  try {
    localStorage.setItem(notifyKey, turningOn ? "on" : "off");
  } catch {
    /* private mode */
  }
  paintNotify();
  if (turningOn) void allowSystemNotice();
});
paintNotify();
if (noticesEnabled()) void allowSystemNotice();
brand.append(mark, el("strong", undefined, text.app), notifyButton, themeSwitch);
paintTheme(savedTheme());
accountPane.append(brand, accountList, footer);
const accountFilters = el("div", "filters account-filters");
listHead.append(search, filters, accountFilters);
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
const toastRoot = el("div", "toasts");
toastRoot.setAttribute("aria-live", "polite");
app.append(shell, toastRoot);

for (const item of [{ id: "all" as const, label: text.all }, ...platforms.map((item) => ({ id: item.id, label: item.name })), { id: "hidden" as const, label: text.hidden }]) {
  const button = el("button", undefined, item.label);
  button.dataset.filter = item.id;
  button.addEventListener("click", () => {
    state.filter = item.id;
    if (item.id !== "all" && item.id !== "hidden" && state.accountFilter && !state.accountFilter.startsWith(item.id + ":")) state.accountFilter = "";
    if (item.id === "hidden") state.accountFilter = "";
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

function icon(name: "send" | "sync" | "sun" | "moon" | "smile" | "image" | "x" | "bell" | "bell-off" | "eye" | "eye-off" | "trash"): SVGElement {
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
  if (name === "bell") paths.push("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0");
  if (name === "bell-off") paths.push("M13.73 21a2 2 0 0 1-3.46 0", "M18.63 13A17.89 17.89 0 0 1 18 8", "M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14", "M18 8a6 6 0 0 0-9.33-5", "m2 2 20 20");
  if (name === "eye") paths.push("M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z");
  if (name === "eye-off") paths.push("M9.88 9.88a3 3 0 1 0 4.24 4.24", "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68", "M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61", "m2 2 20 20");
  if (name === "trash") paths.push("M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2");
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
  return item.platform + ":" + (item.accountId || "main") + ":" + item.id;
}

function accountSlots(): Account[] {
  return state.accounts?.accounts ?? [];
}

function findAccount(platform: PlatformId, id = "main"): Account | undefined {
  return accountSlots().find((item) => item.platform === platform && item.id === id);
}

function accountKey(account: Account): string {
  return account.platform + ":" + account.id;
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

const loginTimers = new Map<string, number>();

function watchLogin(platform: PlatformId, accountId: string): void {
  const timerKey = platform + ":" + accountId;
  window.clearInterval(loginTimers.get(timerKey));
  let tries = 0;
  let running = false;
  loginTimers.set(timerKey, window.setInterval(() => {
    tries += 1;
    if (tries > 40 || findAccount(platform, accountId)?.bound) {
      window.clearInterval(loginTimers.get(timerKey));
      return;
    }
    if (running || state.busy) return;
    running = true;
    void invoke<Accounts>("probe_login", { platform, accountId })
      .then(async (accounts) => {
        const became = !findAccount(platform, accountId)?.bound && accounts.accounts.some((item) => item.platform === platform && item.id === accountId && item.bound);
        rememberAccounts(accounts);
        renderAccounts();
        if (!became) return;
        window.clearInterval(loginTimers.get(timerKey));
        await syncOne(platform, accountId, false);
        renderList();
        footer.textContent = state.status;
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, 2000));
}

async function openPlatform(platform: PlatformId, accountId: string, entry: EntryId): Promise<void> {
  await run(text.open, async () => {
    rememberAccounts(await invoke<Accounts>("open_platform", { platform, accountId, entry, focus: true }));
    state.status = text.windowOn;
  });
  if (entry === "home") watchLogin(platform, accountId);
}

async function confirm(platform: PlatformId, accountId: string, force: boolean): Promise<void> {
  await run(text.done, async () => {
    rememberAccounts(await invoke<Accounts>("confirm_login", { platform, accountId, force }));
    state.status = findAccount(platform, accountId)?.nickname || text.done;
    await syncOne(platform, accountId, false);
  });
}

async function syncOne(platform: PlatformId, accountId: string, interactive: boolean): Promise<void> {
  const result = await invoke<SyncResult>("sync_platform", { platform, accountId, interactive });
  rememberAccounts(result.accounts);
  state.conversations = [
    ...state.conversations.filter((item) => item.platform !== platform || (item.accountId || "main") !== accountId),
    ...dropDeleted(result.conversations),
  ];
  renderList();
  state.status = result.warning || `${platforms.find((item) => item.id === platform)?.name} ${result.conversations.length}`;
}

async function syncPlatform(platform: PlatformId, accountId: string): Promise<void> {
  await run(text.sync, async () => {
    await syncOne(platform, accountId, true);
  });
  await followConversationUpdates();
}

async function syncAll(): Promise<void> {
  await run(text.syncAll, async () => {
    for (const account of accountSlots()) {
      if (account.bound) await syncOne(account.platform, account.id, false);
    }
  });
  await followConversationUpdates();
}

async function addAccount(platform: PlatformId): Promise<void> {
  const before = new Set(accountSlots().filter((item) => item.platform === platform).map((item) => item.id));
  await run(text.addAccount, async () => {
    rememberAccounts(await invoke<Accounts>("add_account", { platform }));
  });
  const created = accountSlots().find((item) => item.platform === platform && !before.has(item.id));
  if (created) await openPlatform(platform, created.id, "home");
}

async function removeAccount(account: Account): Promise<void> {
  const name = account.nickname || platforms.find((item) => item.id === account.platform)?.name || "";
  if (!window.confirm("\u79fb\u9664\u8d26\u53f7\u300c" + name + "\u300d\uff1f")) return;
  await run(text.removeAccount, async () => {
    rememberAccounts(await invoke<Accounts>("remove_account", { platform: account.platform, accountId: account.id }));
    state.conversations = state.conversations.filter((item) => item.platform !== account.platform || (item.accountId || "main") !== account.id);
    if (state.activeKey.startsWith(account.platform + ":" + account.id + ":")) {
      state.activeKey = "";
      state.messages = [];
      renderThread();
    }
  });
}

let threadToken = 0;
let threadRefreshing = false;
let threadRefreshAgain = false;
const seenThreads = new Map<string, string>();

function conversationStamp(item: Conversation): string {
  return item.preview + "\n" + item.time + "\n" + String(item.unread);
}

const hiddenStore = "easy-msg-hidden";
const deletedStore = "easy-msg-deleted";
const hiddenKeys = new Set<string>();
const deletedStamps = new Map<string, string>();

function loadLocalSets(): void {
  try {
    const hidden = JSON.parse(localStorage.getItem(hiddenStore) || "[]") as unknown;
    if (Array.isArray(hidden)) {
      for (const key of hidden) if (typeof key === "string") hiddenKeys.add(key);
    }
  } catch { /* ignore */ }
  try {
    const deleted = JSON.parse(localStorage.getItem(deletedStore) || "{}") as unknown;
    if (deleted && typeof deleted === "object") {
      for (const [key, value] of Object.entries(deleted as Record<string, unknown>)) {
        if (typeof value === "string") deletedStamps.set(key, value);
      }
    }
  } catch { /* ignore */ }
}

function saveHidden(): void {
  try { localStorage.setItem(hiddenStore, JSON.stringify([...hiddenKeys])); } catch { /* ignore */ }
}

function saveDeleted(): void {
  try { localStorage.setItem(deletedStore, JSON.stringify(Object.fromEntries(deletedStamps))); } catch { /* ignore */ }
}

loadLocalSets();

function isHidden(item: Conversation): boolean {
  return hiddenKeys.has(keyOf(item));
}

function dropDeleted(items: Conversation[]): Conversation[] {
  return items.filter((item) => {
    const key = keyOf(item);
    const stamp = conversationStamp(item);
    const deleted = deletedStamps.get(key);
    if (!deleted) return true;
    if (deleted === stamp) return false;
    deletedStamps.delete(key);
    saveDeleted();
    return true;
  });
}

function hideConversation(item: Conversation): void {
  hiddenKeys.add(keyOf(item));
  saveHidden();
  renderFilters();
  renderList();
}

function unhideConversation(item: Conversation): void {
  hiddenKeys.delete(keyOf(item));
  saveHidden();
  renderFilters();
  renderList();
}

function deleteConversation(item: Conversation): void {
  const key = keyOf(item);
  deletedStamps.set(key, conversationStamp(item));
  saveDeleted();
  hiddenKeys.delete(key);
  saveHidden();
  state.conversations = state.conversations.filter((entry) => keyOf(entry) !== key);
  if (state.activeKey === key) {
    state.activeKey = "";
    state.messages = [];
    renderThread();
  }
  renderList();
}

function consumeConversationChanges(): Conversation[] {
  const changed: Conversation[] = [];
  const live = new Set<string>();
  for (const item of state.conversations) {
    const key = keyOf(item);
    live.add(key);
    const stamp = conversationStamp(item);
    const previous = seenThreads.get(key);
    if (previous !== undefined && previous !== stamp) {
      changed.push(item);
      if (isIncoming(item, previous)) showNotice(item);
    }
    seenThreads.set(key, stamp);
  }
  for (const key of [...seenThreads.keys()]) {
    if (!live.has(key)) seenThreads.delete(key);
  }
  return changed;
}

function stampParts(stamp: string): { preview: string; time: string; unread: number } {
  const parts = stamp.split("\n");
  const unread = Number(parts.pop());
  const time = parts.pop() || "";
  return { preview: parts.join("\n"), time, unread: Number.isFinite(unread) ? unread : 0 };
}

const outgoingPreview = new Map<string, { text: string; until: number }>();

function noteOutgoing(key: string, text: string): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  outgoingPreview.set(key, { text: clean, until: Date.now() + 120000 });
}

function isOwnPreview(item: Conversation): boolean {
  const preview = item.preview.replace(/\s+/g, " ").trim();
  const sent = outgoingPreview.get(keyOf(item));
  return Boolean(sent && sent.until > Date.now() && preview === sent.text);
}

function isIncoming(item: Conversation, previous: string): boolean {
  if (deletedStamps.has(keyOf(item))) return false;
  if (isOwnPreview(item)) return false;
  const old = stampParts(previous);
  if (item.unread > old.unread) return true;
  return item.preview !== old.preview;
}

function foreignTail(previous: ChatMessage[], next: ChatMessage[]): ChatMessage | null {
  const known = previous.filter((message) => !message.pending && !message.id.startsWith("preview-") && !message.id.startsWith("local-"));
  if (!known.length || !next.length) return null;
  const tail = next[next.length - 1];
  const last = known[known.length - 1];
  if (!tail || tail.fromMe || tail.pending) return null;
  if (tail.id === last.id && tail.text === last.text) return null;
  return tail;
}

const toastNodes = new Map<string, HTMLButtonElement>();
const toastTimers = new Map<string, number>();

function dismissNotice(key: string): void {
  window.clearTimeout(toastTimers.get(key));
  toastTimers.delete(key);
  const node = toastNodes.get(key);
  toastNodes.delete(key);
  node?.remove();
}

function noticeAccount(item: Conversation): string {
  const platformName = platforms.find((entry) => entry.id === item.platform)?.name || "";
  const account = findAccount(item.platform, item.accountId || "main");
  return account?.nickname ? platformName + " \u00b7 " + account.nickname : platformName;
}


async function allowSystemNotice(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

async function pushSystemNotice(item: Conversation): Promise<boolean> {
  try {
    const win = getCurrentWindow();
    const minimized = await win.isMinimized();
    const focused = await win.isFocused();
    if (!minimized && focused) return false;
    if (!(await allowSystemNotice())) return false;
    const account = noticeAccount(item);
    sendNotification({
      title: item.title || text.newMessage,
      body: account ? account + " " + (item.preview || text.newMessage) : (item.preview || text.newMessage),
    });
    return true;
  } catch {
    return false;
  }
}

const recentNotices = new Map<string, number>();

function showNotice(item: Conversation): void {
  if (!noticesEnabled()) return;
  const key = keyOf(item);
  const signature = key + "\n" + item.preview;
  const now = Date.now();
  const seen = recentNotices.get(signature);
  if (seen && now - seen < 120000) return;
  recentNotices.set(signature, now);
  void pushSystemNotice(item).then((sent) => {
    if (sent) dismissNotice(key);
  });
  dismissNotice(key);
  const toast = el("button", "toast " + item.platform);
  toast.type = "button";
  if (item.avatar) {
    const image = el("img", "avatar") as HTMLImageElement;
    image.src = item.avatar;
    image.alt = "";
    toast.append(image);
  } else {
    toast.append(el("div", "letter", (item.title || "?").slice(0, 1)));
  }
  const body = el("div", "toast-copy");
  body.append(el("div", "name ellipsis", item.title || text.newMessage));
  body.append(el("div", "toast-meta ellipsis", noticeAccount(item)));
  body.append(el("div", "preview ellipsis", item.preview || text.newMessage));
  const close = el("span", "toast-close");
  close.append(icon("x"));
  toast.append(body, close);
  toast.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".toast-close")) {
      dismissNotice(key);
      return;
    }
    if (isHidden(item)) unhideConversation(item);
    void loadConversation(item);
    dismissNotice(key);
  });
  toast.addEventListener("mouseenter", () => window.clearTimeout(toastTimers.get(key)));
  toast.addEventListener("mouseleave", () => {
    toastTimers.set(key, window.setTimeout(() => dismissNotice(key), 2200));
  });
  toastRoot.prepend(toast);
  toastNodes.set(key, toast);
  while (toastRoot.children.length > 4) {
    const last = toastRoot.lastElementChild;
    const lastKey = [...toastNodes.entries()].find((entry) => entry[1] === last)?.[0];
    if (!lastKey) {
      last?.remove();
      break;
    }
    dismissNotice(lastKey);
  }
  toastTimers.set(key, window.setTimeout(() => dismissNotice(key), 7000));
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
        accountId: item.accountId || "main",
        id: item.id,
        title: item.title,
      });
      if (token !== threadToken || state.activeKey !== key || state.busy) return;
      rememberAccounts(result.accounts);
      if (!result.messages.length) continue;
      const tail = result.messages[result.messages.length - 1];
      let listDirty = false;
      const arrived = foreignTail(state.messages, result.messages);
      if (item.preview !== tail.text) {
        item.preview = tail.text;
        listDirty = true;
      }
      if (tail.time && item.time !== tail.time) {
        item.time = tail.time;
        listDirty = true;
      }
      if (arrived && !isOwnPreview(item)) showNotice(item);
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
  const visible = changed.filter((item) => !isHidden(item));
  const next = visible.find((item) => item.unread > 0) || visible[0];
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
      accountId: item.accountId || "main",
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
  noteOutgoing(key, value || text.pictureText);
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
      accountId: item.accountId || "main",
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

function accountTitle(account: Account): string {
  const platformName = platforms.find((item) => item.id === account.platform)?.name || account.platform;
  const peers = accountSlots().filter((item) => item.platform === account.platform);
  if (!account.bound && !account.nickname) return text.unbound;
  if (account.nickname && peers.filter((item) => item.nickname === account.nickname).length < 2) return account.nickname;
  const index = Math.max(1, peers.findIndex((item) => item.id === account.id) + 1);
  return peers.length > 1 ? platformName + " " + index : (account.nickname || platformName);
}

function chipLabel(account: Account, pool: Account[]): string {
  const name = accountTitle(account);
  const clash = pool.filter((item) => accountTitle(item) === name).length > 1;
  if (!clash) return name;
  const platformName = platforms.find((item) => item.id === account.platform)?.name || "";
  return platformName + " " + name;
}

function renderAccounts(): void {
  accountList.replaceChildren();
  if (!state.accounts) return;
  for (const platform of platforms) {
    accountList.append(el("div", "platform-label", platform.name));
    const mine = accountSlots().filter((account) => account.platform === platform.id);
    for (const account of mine) {
      const box = el("section", `account ${platform.id}`);
      if (state.accountFilter === accountKey(account)) box.classList.add("selected");
      const top = el("div", "account-top");
      if (account.avatar) {
        const image = el("img", "avatar") as HTMLImageElement;
        image.src = account.avatar;
        image.alt = "";
        top.append(image);
      } else {
        top.append(el("div", "letter", (account.nickname || platform.name).slice(0, 1)));
      }
      const meta = el("div");
      meta.append(el("div", "name ellipsis", accountTitle(account)));
      meta.append(el("div", "sub ellipsis", account.lastSyncAt ? clock(account.lastSyncAt) : ""));
      top.append(meta);
      top.addEventListener("click", () => {
        const key = accountKey(account);
        state.filter = account.platform;
        state.accountFilter = state.accountFilter === key ? "" : key;
        renderFilters();
        renderAccounts();
        renderList();
      });
      box.append(top);
      const actions = el("div", "actions");
      if (!account.bound) {
        actions.append(
          actionButton(text.bind, () => void openPlatform(platform.id, account.id, "home")),
          actionButton(text.done, () => void confirm(platform.id, account.id, false)),
          actionButton(text.force, () => void confirm(platform.id, account.id, true)),
        );
      } else {
        actions.append(
          actionButton(text.sync, () => void syncPlatform(platform.id, account.id), true),
          actionButton(text.relogin, () => void openPlatform(platform.id, account.id, "home")),
          actionButton(text.dm, () => void openPlatform(platform.id, account.id, "messages")),
        );
      }
      if (mine.length > 1 || account.bound) actions.append(actionButton(text.removeAccount, () => void removeAccount(account)));
      box.append(actions);
      if (account.lastError) box.append(el("div", "error ellipsis", account.lastError));
      accountList.append(box);
    }
    const wrap = el("div", "actions");
    wrap.append(actionButton(text.addAccount, () => void addAccount(platform.id)));
    accountList.append(wrap);
  }
  const syncAllButton = actionButton(text.syncAll, () => void syncAll(), true);
  syncAllButton.classList.add("primary");
  const syncWrap = el("div", "actions");
  syncWrap.className = "actions sync-wrap";
  syncWrap.append(syncAllButton);
  accountList.append(syncWrap);
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
  accountFilters.replaceChildren();
  const pool = accountSlots().filter((account) => {
    if (!account.bound) return false;
    if (state.filter === "hidden") return false;
    if (state.filter !== "all" && account.platform !== state.filter) return false;
    return true;
  });
  accountFilters.hidden = pool.length < 2;
  if (pool.length < 2) return;
  const all = el("button", undefined, text.all);
  all.type = "button";
  all.classList.toggle("active", state.accountFilter === "");
  all.disabled = state.busy;
  all.addEventListener("click", () => {
    state.accountFilter = "";
    renderFilters();
    renderAccounts();
    renderList();
  });
  accountFilters.append(all);
  for (const account of pool) {
    const key = accountKey(account);
    const button = el("button", undefined, chipLabel(account, pool));
    button.type = "button";
    button.classList.toggle("active", state.accountFilter === key);
    button.disabled = state.busy;
    button.addEventListener("click", () => {
      state.accountFilter = state.accountFilter === key ? "" : key;
      renderFilters();
      renderAccounts();
      renderList();
    });
    accountFilters.append(button);
  }
}

function visibleConversations(): Conversation[] {
  return state.conversations.filter((item) => {
    const hidden = isHidden(item);
    if (state.filter === "hidden") {
      if (!hidden) return false;
    } else if (hidden || (state.filter !== "all" && item.platform !== state.filter)) return false;
    if (state.accountFilter) {
      const split = state.accountFilter.indexOf(":");
      const platform = state.accountFilter.slice(0, split);
      const id = state.accountFilter.slice(split + 1);
      if (item.platform !== platform || (item.accountId || "main") !== id) return false;
    }
    if (!state.query) return true;
    return `${item.title} ${item.preview}`.toLowerCase().includes(state.query);
  });
}

function rowTool(name: "eye" | "eye-off" | "trash", label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", "icon-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderList(): void {
  const rows = visibleConversations();
  list.replaceChildren();
  if (state.booting && !state.conversations.length) {
    const box = el("div", "loading-state");
    const head = el("div", "loading-head");
    head.append(el("span", "spin"), el("span", undefined, text.loading));
    box.append(head);
    for (let index = 0; index < 6; index += 1) {
      const row = el("div", "skeleton");
      const lines = el("div", "skeleton-lines");
      lines.append(el("div", "skeleton-line"), el("div", "skeleton-line short"));
      row.append(el("div", "skeleton-avatar"), lines);
      box.append(row);
    }
    list.append(box);
    return;
  }
  if (!rows.length) {
    list.append(el("div", "sub empty-list", state.filter === "hidden" ? text.hiddenEmpty : text.empty));
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
    const side = el("div", "row-side");
    const meta = el("div", "row-meta");
    meta.append(el("div", "time", item.time));
    if (item.unread) meta.append(el("div", "unread", String(item.unread)));
    const actions = el("div", "row-actions");
    const hidden = isHidden(item);
    actions.append(rowTool(hidden ? "eye" : "eye-off", hidden ? text.unhide : text.hide, () => hidden ? unhideConversation(item) : hideConversation(item)));
    actions.append(rowTool("trash", text.deleteChat, () => deleteConversation(item)));
    side.append(meta, actions);
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
  const tools = el("div", "thread-tools");
  const hidden = isHidden(item);
  tools.append(rowTool(hidden ? "eye" : "eye-off", hidden ? text.unhide : text.hide, () => hidden ? unhideConversation(item) : hideConversation(item)));
  tools.append(rowTool("trash", text.deleteChat, () => deleteConversation(item)));
  threadHead.append(tag, title, tools);
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
  const bound = accountSlots().filter((account) => account.bound);
  if (!bound.length) return;
  await run(text.sync, async () => {
    for (const account of bound) await syncOne(account.platform, account.id, false);
  });
  await followConversationUpdates();
}

async function recoverLogins(): Promise<void> {
  if (!state.accounts) return;
  for (const account of accountSlots()) {
    if (account.bound) continue;
    try {
      const accounts = await invoke<Accounts>("probe_login", { platform: account.platform, accountId: account.id });
      const became = !findAccount(account.platform, account.id)?.bound && accounts.accounts.some((item) => item.platform === account.platform && item.id === account.id && item.bound);
      rememberAccounts(accounts);
      renderAccounts();
      if (became) await syncOne(account.platform, account.id, false);
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
  })
  .finally(() => {
    state.booting = false;
    renderList();
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
