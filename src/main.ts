import { invoke } from "@tauri-apps/api/core";

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

search.type = "search";
search.placeholder = text.search;
draft.placeholder = text.compose;
sendButton.type = "submit";
sendButton.append(icon("send"), document.createTextNode(text.send));

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

const emoji = [
  0x1f600, 0x1f603, 0x1f604, 0x1f601, 0x1f606, 0x1f605, 0x1f602, 0x1f923, 0x1f60a, 0x1f970,
  0x1f60d, 0x1f618, 0x1f60e, 0x1f914, 0x1f92b, 0x1f917, 0x1f97a, 0x1f60f, 0x1f644, 0x1f62e,
  0x1f62d, 0x1f622, 0x1f621, 0x1f631, 0x1f92f, 0x1f634, 0x1f973, 0x1f60c, 0x1f637, 0x1f924,
  0x1f44d, 0x1f44e, 0x1f44c, 0x270c, 0x1f91e, 0x1f44a, 0x1f91d, 0x1f64f, 0x1f44f, 0x1f64c, 0x1f4aa,
  0x2764, 0x1f9e1, 0x1f49b, 0x1f49a, 0x1f499, 0x1f49c, 0x1f5a4, 0x1f494, 0x1f495, 0x1f496, 0x1f497,
  0x1f525, 0x2728, 0x2b50, 0x1f31f, 0x1f389, 0x1f381, 0x1f339, 0x1f340, 0x2600, 0x1f319, 0x26a1,
  0x2615, 0x1f382, 0x1f370, 0x1f349, 0x2705, 0x274c, 0x2753, 0x2757, 0x1f4af,
  0x1f436, 0x1f431, 0x1f43c, 0x1f98a, 0x1f437, 0x1f438,
].map((code) => String.fromCodePoint(code));
for (const symbol of emoji) {
  const button = el("button");
  button.type = "button";
  button.textContent = symbol;
  button.title = symbol;
  button.addEventListener("click", () => {
    const start = draft.selectionStart ?? draft.value.length;
    const end = draft.selectionEnd ?? start;
    draft.setRangeText(symbol, start, end, "end");
    draft.focus();
    emojiPop.hidden = true;
    refreshSend();
  });
  emojiPop.append(button);
}
emojiPop.addEventListener("mousedown", (event) => event.preventDefault());
emojiButton.addEventListener("click", () => {
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
  sendButton.disabled = state.busy || !activeConversation() || (!draft.value.trim() && !pendingImage);
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
}

async function syncAll(): Promise<void> {
  await run(text.syncAll, async () => {
    for (const platform of platforms) {
      if (state.accounts?.[platform.id].bound) await syncOne(platform.id, false);
    }
  });
}

async function loadConversation(item: Conversation): Promise<void> {
  state.activeKey = keyOf(item);
  renderList();
  await run(item.title, async () => {
    const result = await invoke<ThreadResult>("load_thread", {
      platform: item.platform,
      id: item.id,
      title: item.title,
    });
    rememberAccounts(result.accounts);
    const tail = result.messages[result.messages.length - 1];
    if (tail) {
      item.preview = tail.text;
      if (tail.time) item.time = tail.time;
    }
    state.messages = result.messages.length
      ? result.messages
      : item.preview
        ? [{ id: "preview-" + item.id, text: item.preview, fromMe: false, time: item.time }]
        : [];
    state.threadWarning = result.messages.length ? result.warning : item.preview ? "" : result.warning;
    state.status = state.threadWarning || item.title;
  });
}

async function sendCurrent(): Promise<void> {
  const item = activeConversation();
  const value = draft.value.trim();
  const image = pendingImage;
  if (!item || (!value && !image)) return;
  await run(text.send, async () => {
    const result = await invoke<ThreadResult>("send_message", {
      platform: item.platform,
      id: item.id,
      title: item.title,
      text: value,
      image: image ? { name: image.name, mime: image.mime, data: image.data } : null,
    });
    rememberAccounts(result.accounts);
    state.threadWarning = result.warning;
    const next = result.messages.length
      ? result.messages.map((message) => ({ ...message }))
      : [
          ...state.messages,
          ...(value ? [{ id: `local-${Date.now()}`, text: value, fromMe: true, time: "" }] : []),
          ...(image ? [{ id: `local-img-${Date.now()}`, text: text.pictureText, fromMe: true, time: "", image: image.preview }] : []),
        ];
    if (image) {
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const message = next[index];
        if (message.fromMe && message.text.includes("\u56fe\u7247") && !message.image) {
          message.image = image.preview;
          break;
        }
      }
    }
    state.messages = next;
    if (!value || result.textSent) draft.value = "";
    if (!image || result.imageSent) pendingImage = null;
    renderAttach();
    state.status = result.warning || text.send;
  });
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
    body.append(titleRow, el("div", "preview ellipsis", item.preview));
    button.append(body);
    const side = el("div");
    side.append(el("div", "time", item.time));
    if (item.unread) side.append(el("div", "unread", String(item.unread)));
    button.append(side);
    button.addEventListener("click", () => void loadConversation(item));
    list.append(button);
  }
}

function renderThread(): void {
  const item = activeConversation();
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
    if (showText || !message.image) bubble.append(document.createTextNode(message.text));
    if (message.time) bubble.append(el("span", "time", message.time));
    messages.append(bubble);
  }
  messages.scrollTop = messages.scrollHeight;
  refreshSend();
}

async function syncBound(): Promise<void> {
  if (!state.accounts) return;
  const bound = platforms.filter((item) => state.accounts?.[item.id].bound);
  if (!bound.length) return;
  await run(text.sync, async () => {
    for (const platform of bound) await syncOne(platform.id, false);
  });
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

renderFilters();
