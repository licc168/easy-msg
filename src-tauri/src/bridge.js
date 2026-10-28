const BLOCK = new Set([
  "\u53d1\u73b0",
  "\u9996\u9875",
  "\u6d88\u606f",
  "\u6211",
  "\u767b\u5f55",
  "\u53d1\u5e03",
  "\u901a\u77e5",
  "\u63a8\u8350",
  "\u5173\u6ce8",
  "\u670b\u53cb",
  "\u66f4\u591a",
  "\u641c\u7d22",
  "\u79c1\u4fe1",
]);

function allDocs() {
  const docs = [document];
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      if (frame.contentDocument && frame.contentDocument.body) docs.push(frame.contentDocument);
    } catch (error) {
      continue;
    }
  }
  return docs;
}

function queryAll(selector) {
  const result = [];
  for (const doc of allDocs()) result.push(...doc.querySelectorAll(selector));
  return result;
}

function visible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const view = el.ownerDocument && el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
}

function linesOf(el) {
  return (el.innerText || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function exactVisible(words) {
  const wanted = new Set(words);
  const matches = queryAll("a,button,[role='button'],div,span").filter((el) => {
    if (!visible(el)) return false;
    return wanted.has((el.innerText || "").replace(/\s+/g, " ").trim());
  });
  const deepest = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
  deepest.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.width * ra.height - rb.width * rb.height;
  });
  return deepest[0] || null;
}

function navName(line) {
  return BLOCK.has(line) || line === "\u6211\u7684" || line === "\u7cbe\u9009" || line === "\u76f4\u64ad" || line === "\u653e\u6620\u5385";
}

function profileNickname(profile) {
  if (!profile) return "";
  const image = profile.querySelector("img");
  const candidates = [
    profile.getAttribute("aria-label") || "",
    profile.getAttribute("title") || "",
    image ? image.alt || "" : "",
    profile.tagName === "IMG" ? profile.alt || "" : "",
  ].concat(linesOf(profile));
  return candidates.map((line) => String(line).replace(/\s+/g, " ").trim()).find((line) => line && line.length <= 32 && !navName(line) && !/^\d+$/.test(line)) || "";
}

function controlByLabel(words) {
  const matches = queryAll("a,button,[role='button'],div,span,li").filter((el) => {
    if (!visible(el)) return false;
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    const label = ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "")).trim();
    if (words.indexOf(text) >= 0) return true;
    if (!label) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 120 || rect.height > 120) return false;
    return words.some((word) => label.indexOf(word) >= 0);
  });
  const deepest = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
  deepest.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.width * ra.height - rb.width * rb.height;
  });
  return deepest[0] || null;
}

function headerUserLink() {
  const found = queryAll("[data-e2e='live-avatar'], [data-e2e='user-info'], a[href*='/user/']").filter((el) => {
    if (!visible(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > 180) return false;
    if (rect.width < 20 || rect.height < 20 || rect.width > 240) return false;
    return Boolean(el.querySelector("img"));
  });
  found.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.width * ra.height - rb.width * rb.height;
  });
  return found[0] || null;
}

function scanPending() {
  return queryAll("div,section,p,span,h1,h2,button").some((el) => {
    if (!visible(el)) return false;
    const text = (el.innerText || "").replace(/\s+/g, "").trim();
    if (!text || text.length > 16 || !text.includes("\u626b\u7801\u767b\u5f55")) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 72 && rect.height >= 16 && rect.top > 60 && rect.top < 680;
  });
}

function httpsUrl(value) {
  const text = String(value || "").trim();
  if (text.startsWith("https://")) return text;
  if (text.startsWith("http://")) return "https://" + text.slice(7);
  if (text.startsWith("//")) return "https:" + text;
  return "";
}

function xhsSelf() {
  return queryAll("a[href*='/user/profile'], a[href*='/user/self'], [data-e2e='user-info']").find((el) => {
    if (!visible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 16 && rect.height >= 16 && rect.width <= 280 && rect.height <= 140;
  }) || null;
}

function digStoredUser(value, depth) {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (!Array.isArray(value)) {
    const nickname = firstString(value, ["nickname", "nickName", "userName"]);
    const avatar = httpsUrl(firstString(value, ["avatar", "image", "imageb", "images", "avatarUrl"]));
    const id = firstString(value, ["userId", "user_id", "uid", "redId"]);
    if (nickname && nickname.length <= 32 && !navName(nickname) && (id || avatar)) return { nickname, avatar };
  }
  const children = Array.isArray(value) ? value.slice(0, 6) : Object.keys(value).slice(0, 16).map((key) => value[key]);
  for (const child of children) {
    const found = digStoredUser(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseStored(raw) {
  if (!raw || raw.length > 300000) return null;
  try {
    let value = JSON.parse(raw);
    if (typeof value === "string" && value.length < 300000) {
      try { value = JSON.parse(value); } catch (error) { /* already a string */ }
    }
    return value;
  } catch (error) {
    return null;
  }
}

function directUser(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nests = [value, value.user, value.userInfo, value.user_info, value.profile, value.data, value.account];
  for (const item of nests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const nickname = firstString(item, ["nickname", "nickName", "userName", "name"]);
    const avatar = httpsUrl(firstString(item, ["avatar", "avatarUrl", "avatarUri", "avatar_url", "image", "imageb", "images"]));
    const id = firstString(item, ["userId", "user_id", "uid", "secUid", "sec_uid", "redId", "red_id"]);
    if (nickname && id && nickname.length <= 32 && !navName(nickname)) return { nickname, avatar };
  }
  return null;
}

function storageProfile() {
  const bags = [localStorage, sessionStorage];
  let fallback = null;
  for (const bag of bags) {
    let keys = [];
    try { keys = Object.keys(bag); } catch (error) { continue; }
    const ordered = keys.filter((key) => /self|current|profile|userinfo|user-info|user_info|loginuser|login-user/i.test(key))
      .concat(keys.filter((key) => !/self|current|profile|userinfo|user-info|user_info|loginuser|login-user/i.test(key)));
    for (const key of ordered) {
      if (/conv|message|history|session-list|emoji/i.test(key)) continue;
      let raw = "";
      try { raw = bag.getItem(key) || ""; } catch (error) { continue; }
      const found = directUser(parseStored(raw));
      if (!found) continue;
      if (/self|current|profile|userinfo|user-info|user_info|loginuser/i.test(key)) return found;
      if (!fallback) fallback = found;
    }
  }
  return fallback;
}

function railAvatar() {
  const images = queryAll("img").filter((img) => {
    if (!visible(img)) return false;
    const rect = img.getBoundingClientRect();
    if (rect.left > 88 || rect.top < 0 || rect.top > 760) return false;
    if (rect.width < 24 || rect.height < 24 || rect.width > 72 || rect.height > 72) return false;
    const src = httpsUrl(img.currentSrc || img.src);
    return Boolean(src) && !/emoji|icon-login|logo|qrcode/i.test(src + " " + img.className);
  });
  const linked = images.find((img) => {
    const host = img.closest ? img.closest("a") : null;
    return host && /\/user\/|profile|self/i.test(host.getAttribute("href") || "");
  });
  if (linked) return linked;
  const named = images.find((img) => /avatar/i.test(String(img.className || "") + " " + String(img.parentElement && img.parentElement.className || "")));
  if (named) return named;
  images.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
  return images[0] || null;
}


const identityCache = { host: "", at: 0, ttl: 0, value: null, debug: null };
const xhsFetchCache = { id: "", at: 0, user: null, attempts: [] };

function accountIdentity() {
  const host = location.hostname;
  const now = Date.now();
  if (identityCache.value && identityCache.value.nickname && identityCache.host === host && now - identityCache.at < identityCache.ttl) {
    return identityCache.value;
  }
  const onDouyin = host.indexOf("douyin") >= 0;
  const onXhs = host.indexOf("xiaohongshu") >= 0;
  const packed = onDouyin
    ? readDouyinIdentity()
    : (onXhs ? readXhsIdentity() : { value: storageProfile() || { nickname: "", avatar: "" }, debug: { source: "storage" } });
  const value = {
    nickname: (packed.value && packed.value.nickname) || "",
    avatar: (packed.value && packed.value.avatar) || "",
  };
  identityCache.host = host;
  identityCache.at = now;
  identityCache.ttl = value.nickname ? 180000 : 20000;
  identityCache.value = value;
  identityCache.debug = packed.debug || null;
  return value;
}

function storedBag(key) {
  try {
    return parseStored(localStorage.getItem(key) || "");
  } catch (error) {
    return null;
  }
}

function readDouyinIdentity() {
  let nickname = "";
  let avatar = "";
  const seen = [];
  for (const key of ["user_info", "user_info_passport"]) {
    const found = directUser(storedBag(key)) || digStoredUser(storedBag(key), 0);
    seen.push(key + ":" + (found && found.nickname ? "yes" : "no"));
    if (!found) continue;
    if (!nickname && found.nickname && !navName(found.nickname)) nickname = found.nickname;
    if (!avatar && found.avatar) avatar = found.avatar;
  }
  return {
    value: { nickname, avatar },
    debug: { source: "douyin-storage", seen, nickname, avatar: avatar.slice(0, 180) },
  };
}

function imageUrl(img) {
  if (!img) return "";
  const values = [
    img.getAttribute("src"),
    img.getAttribute("data-src"),
    img.getAttribute("data-origin"),
    (img.getAttribute("srcset") || "").split(",")[0],
    img.currentSrc,
    img.src,
  ];
  for (const value of values) {
    const url = httpsUrl(String(value || "").trim().split(/\s+/)[0]);
    if (!url || /emoji|logo|qrcode|icon-login|picasso-static|fe-platform|fe-video/i.test(url)) continue;
    return url;
  }
  return "";
}

function xhsSidebar() {
  const images = queryAll("a[href*='/user/profile'] img").filter((img) => {
    if (!visible(img)) return false;
    const rect = img.getBoundingClientRect();
    return rect.left < 160 && rect.width >= 16 && rect.width <= 80 && rect.height >= 16 && rect.height <= 80;
  });
  images.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const img = images.length ? images[images.length - 1] : null;
  if (!img) return { id: "", avatar: "", src: "", currentSrc: "" };
  const host = img.closest("a");
  const href = host ? host.getAttribute("href") || "" : "";
  const match = href.match(/\/user\/profile\/([A-Za-z0-9]+)/);
  return {
    id: match ? match[1] : "",
    avatar: imageUrl(img),
    src: String(img.getAttribute("src") || "").slice(0, 180),
    currentSrc: String(img.currentSrc || img.src || "").slice(0, 180),
  };
}

function pickUser(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const nickname = firstString(item, ["nickname", "nickName", "userName"]);
  if (!nickname || nickname.length > 32 || navName(nickname)) return null;
  const avatar = httpsUrl(firstString(item, ["imageb", "images", "image", "avatar", "avatarUrl"]));
  const id = firstString(item, ["userId", "user_id", "redId", "red_id", "uid"]);
  if (!id && !avatar) return null;
  return { nickname, avatar };
}

function xhsUserFromState(state) {
  if (!state || typeof state !== "object") return null;
  const user = state.user && typeof state.user === "object" ? state.user : state;
  const pools = [
    user.userInfo,
    user.basicInfo,
    user.userPageData && user.userPageData.basicInfo,
    user.data && user.data.basicInfo,
    state.basicInfo,
    state.data && state.data.basic_info,
    state.data,
  ];
  for (const item of pools) {
    const found = pickUser(item);
    if (found) return found;
  }
  return null;
}

function pageUser() {
  const bags = [];
  try { if (window.__INITIAL_STATE__) bags.push(window.__INITIAL_STATE__); } catch (error) { /* ignore */ }
  try { if (window.__INITIAL_SSR_STATE__) bags.push(window.__INITIAL_SSR_STATE__); } catch (error) { /* ignore */ }
  try {
    const el = document.querySelector("#app") || document.querySelector("#root");
    const pinia = el && el.__vue_app__ && el.__vue_app__.config && el.__vue_app__.config.globalProperties && el.__vue_app__.config.globalProperties.$pinia;
    const state = pinia && pinia.state && pinia.state.value;
    if (state) {
      for (const key of Object.keys(state)) bags.push(state[key]);
    }
  } catch (error) { /* ignore */ }
  for (const bag of bags) {
    const found = xhsUserFromState(bag);
    if (found && found.nickname) return found;
  }
  return null;
}

function findIdUser(value, userId, depth) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (!Array.isArray(value)) {
    const id = firstString(value, ["userId", "user_id"]);
    if (id === userId) {
      const found = pickUser(value);
      if (found) return found;
    }
  }
  const children = Array.isArray(value) ? value.slice(0, 8) : Object.keys(value).slice(0, 24).map((key) => value[key]);
  for (const child of children) {
    const found = findIdUser(child, userId, depth + 1);
    if (found) return found;
  }
  return null;
}

function fiberSelf(userId) {
  if (!userId) return null;
  const stack = [];
  for (const doc of allDocs()) {
    const root = doc.getElementById("root") || doc.getElementById("app") || doc.body;
    if (!root) continue;
    const key = Object.keys(root).find((item) => item.startsWith("__reactContainer$") || item.startsWith("__reactFiber$"));
    if (key) stack.push(root[key]);
  }
  const seen = new Set();
  let count = 0;
  while (stack.length && count < 5000) {
    const fiber = stack.pop();
    if (!fiber || typeof fiber !== "object" || seen.has(fiber)) continue;
    seen.add(fiber);
    count += 1;
    try {
      const found = findIdUser(fiber.memoizedProps, userId, 0) || findIdUser(fiber.memoizedState, userId, 0);
      if (found) return found;
    } catch (error) { /* ignore */ }
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  return null;
}

function syncGet(url) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.withCredentials = true;
    xhr.send(null);
    return { status: xhr.status, url: xhr.responseURL || url, text: String(xhr.responseText || "") };
  } catch (error) {
    return { status: 0, url: url, text: "", error: String(error && error.message || error) };
  }
}

function sliceObject(text, index) {
  const start = text.indexOf("{", index);
  if (start < 0 || start - index > 24) return "";
  let depth = 0;
  let quote = "";
  let esc = false;
  const endLimit = Math.min(text.length, start + 800000);
  for (let i = start; i < endLimit; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function parseLoose(raw) {
  if (!raw || raw.length > 800000) return null;
  try {
    let value = JSON.parse(raw);
    if (typeof value === "string" && value.length < 800000) {
      try { value = JSON.parse(value); } catch (error) { /* already a string */ }
    }
    return value;
  } catch (error) {
    return null;
  }
}

function extractInitialState(html) {
  const text = String(html || "");
  const markers = ["window.__INITIAL_STATE__=", "window.__INITIAL_SSR_STATE__="];
  for (const marker of markers) {
    const start = text.indexOf(marker);
    if (start < 0) continue;
    const json = sliceObject(text, start + marker.length).replace(/\bundefined\b/g, "null");
    const parsed = parseLoose(json);
    if (parsed) return parsed;
  }
  return null;
}

function titleName(html) {
  const match = String(html || "").match(/<title>([^<]{1,80})<\/title>/i);
  if (!match) return "";
  const title = match[1].replace(/\s+/g, " ").trim();
  const name = title.split(/\s+-\s+/)[0].trim();
  if (!name || name.length > 32 || navName(name) || name.indexOf("\u5c0f\u7ea2\u4e66") >= 0) return "";
  return name;
}

function userFromResponse(text) {
  if (!text) return null;
  const parsed = parseLoose(text.trim());
  if (parsed) {
    const found = xhsUserFromState(parsed) || xhsUserFromState(parsed.data) || pickUser(parsed.data) || pickUser(parsed);
    if (found) return found;
  }
  const state = extractInitialState(text);
  return state ? xhsUserFromState(state) : null;
}

function fetchXhsUser(id) {
  const urls = [
    "https://www.xiaohongshu.com/user/profile/" + id,
    "/api/sns/web/v2/user/me",
    "/api/sns/web/v1/user/selfinfo",
  ];
  const attempts = [];
  let found = null;
  for (const url of urls) {
    const response = syncGet(url);
    const user = userFromResponse(response.text);
    const nickname = (user && user.nickname) || titleName(response.text);
    attempts.push({
      url,
      status: response.status,
      final: String(response.url || "").slice(0, 140),
      name: nickname || "",
      error: response.error || "",
    });
    if (!found && nickname && !navName(nickname)) {
      found = { nickname, avatar: (user && user.avatar) || "" };
      break;
    }
  }
  return { user: found, attempts };
}

function readXhsIdentity() {
  const side = xhsSidebar();
  const live = pageUser();
  const fiber = live && live.nickname ? null : fiberSelf(side.id);
  let remote = xhsFetchCache.user;
  let attempts = xhsFetchCache.attempts;
  const named = (live && live.nickname) || (fiber && fiber.nickname) || "";
  const now = Date.now();
  if (!named && side.id && (xhsFetchCache.id !== side.id || now - xhsFetchCache.at > 20000)) {
    const fetched = fetchXhsUser(side.id);
    remote = fetched.user;
    attempts = fetched.attempts;
    xhsFetchCache.id = side.id;
    xhsFetchCache.at = now;
    xhsFetchCache.user = remote;
    xhsFetchCache.attempts = attempts;
  }
  const nickname = named || (remote && remote.nickname) || "";
  const avatar = (live && live.avatar) || (fiber && fiber.avatar) || (remote && remote.avatar) || side.avatar || "";
  return {
    value: { nickname, avatar },
    debug: {
      source: "xhs",
      id: side.id,
      side: (side.avatar || "").slice(0, 180),
      src: side.src,
      currentSrc: side.currentSrc,
      live,
      fiber,
      remote,
      attempts,
    },
  };
}

function pageInfo() {
  const loginButton = exactVisible(["\u767b\u5f55", "\u626b\u7801\u767b\u5f55"]);
  const headerLogin = Boolean(loginButton && loginButton.getBoundingClientRect().top < 180);
  const onXhs = location.hostname.indexOf("xiaohongshu") >= 0;
  const scanning = scanPending();
  const identity = accountIdentity();
  let storageUser = Boolean(identity.nickname);
  if (!storageUser) {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!/user|profile|account/i.test(key)) continue;
        const raw = localStorage.getItem(key) || "";
        if (/"nickname"|"nickName"|"userId"|"uid"/.test(raw)) {
          storageUser = true;
          break;
        }
      }
    } catch (error) {
      storageUser = false;
    }
  }
  const cookie = document.cookie || "";
  const xhsSession = /(?:^|;\s*)web_session=/.test(cookie);
  const hasSession = xhsSession || /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|passport_assist_user|login_time)=/.test(cookie) || /(?:^|;\s*)LOGIN_STATUS=(?:1|true)/i.test(cookie);
  const loggedIn = onXhs
    ? Boolean((xhsSession || identity.nickname) && !scanning && !headerLogin)
    : Boolean(storageUser || identity.nickname || (hasSession && (!scanning || /passport_assist_user|login_time|sessionid/.test(cookie))));
  return {
    loggedIn,
    loginRequired: !loggedIn && (scanning || headerLogin),
    nickname: identity.nickname || "",
    avatar: identity.avatar || "",
    url: location.href,
    title: document.title || "",
  };
}


function heuristicRows() {
  const raw = queryAll("li,a,div").filter((el) => {
    if (!visible(el) || !el.querySelector("img") || inOpenThread(el)) return false;
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || "").trim();
    return rect.width >= 140 && rect.width <= 720 && rect.height >= 44 && rect.height <= 180 && text.length > 1 && text.length < 180;
  });
  return raw.filter((el) => !raw.some((other) => other !== el && el.contains(other))).slice(0, 80);
}

function inOpenThread(el) {
  return Boolean(el && el.closest && el.closest(".xhs-im-chat-window, .xhs-im-bubble, .xhs-im-message-list, [class*='MessageList'], [class*='message-list']"));
}

function xhsConversations() {
  const rows = queryAll("[data-conv-id].xhs-im-conv-item, .xhs-im-conv-item[data-conv-id]");
  const items = [];
  const seen = new Set();
  for (const element of rows) {
    if (inOpenThread(element)) continue;
    const id = element.getAttribute("data-conv-id") || "";
    if (!id || seen.has(id)) continue;
    const nameEl = element.querySelector(".xhs-im-conv-item__name");
    const title = nameEl ? (nameEl.innerText || "").replace(/\s+/g, " ").trim() : "";
    if (!title || title.length > 32) continue;
    seen.add(id);
    const previewEl = element.querySelector(".xhs-im-conv-item__summary-text, .xhs-im-conv-item__summary");
    const timeEl = element.querySelector(".xhs-im-conv-item__time");
    const badge = element.querySelector(".xhs-im-conv-item__badge, [class*='unread']");
    let unread = 0;
    if (badge && visible(badge)) {
      const badgeText = (badge.innerText || "").replace(/\s+/g, "");
      unread = /^\d+$/.test(badgeText) ? Number(badgeText) : 1;
    }
    const image = element.querySelector("img");
    items.push({
      id: id,
      title: title,
      preview: previewEl ? (previewEl.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80) : "",
      time: timeEl ? (timeEl.innerText || "").replace(/\s+/g, " ").trim() : "",
      unread: unread,
      avatar: image && String(image.src || "").startsWith("https://") ? image.src : "",
      element: element,
    });
  }
  return items;
}

function rowSizeOk(rect) {
  return rect.width >= 140 && rect.width <= 1100 && rect.height >= 44 && rect.height <= 180;
}

function domConversations() {
  const xhs = xhsConversations();
  if (xhs.length) return xhs;
  const selectors = [
    "[class*='ConversationItemwrapper']",
    "[class*='conversation-item']",
    "[class*='ConversationItem']",
    "[class*='chat-item']",
    "[class*='session-item']",
    "[class*='sessionItem']",
    "[class*='convItem']",
    "[data-e2e*='conversation']",
    "[data-e2e*='session']",
  ];
  let nodes = [];
  for (const selector of selectors) {
    const found = queryAll(selector).filter((el) => {
      if (inOpenThread(el)) return false;
      const rect = el.getBoundingClientRect();
      if (rowSizeOk(rect)) return visible(el);
      const specific = selector.indexOf("ConversationItemwrapper") >= 0 || selector.indexOf("conversation-item") >= 0 || selector.indexOf("data-e2e") >= 0;
      if (!specific || rect.width >= 2 || rect.height >= 2) return false;
      const text = (el.innerText || "").trim();
      return text.length > 1 && text.length < 220;
    });
    const outer = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    if (outer.length >= 1) {
      nodes = outer;
      break;
    }
  }
  if (!nodes.length) nodes = heuristicRows();
  const timePattern = /^(\d{1,2}:\d{2}|\u521a\u521a|\u6628\u5929|\u524d\u5929|\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5]|\d+\u5206\u949f\u524d|\d+\u5c0f\u65f6\u524d|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})$/;
  const items = [];
  const seen = new Set();
  nodes.forEach((element, index) => {
    const lines = linesOf(element);
    const time = lines.find((line) => timePattern.test(line)) || "";
    const title = lines.find((line) => line !== time && line.length <= 32 && !BLOCK.has(line) && !/^\d+$/.test(line));
    if (!title) return;
    const preview = lines.find((line) => line !== title && line !== time && !BLOCK.has(line)) || "";
    const key = title + "|" + preview;
    if (seen.has(key)) return;
    seen.add(key);
    const badge = element.querySelector("[class*='unread'], [class*='UnRead'], [class*='badge'], [class*='count']");
    let unread = 0;
    if (badge && visible(badge)) {
      const badgeText = (badge.innerText || "").replace(/\s+/g, "");
      unread = /^\d+$/.test(badgeText) ? Number(badgeText) : 1;
    }
    const image = element.querySelector("img");
    items.push({
      id: title,
      title,
      preview: preview.slice(0, 80),
      time,
      unread,
      avatar: image && String(image.src || "").startsWith("https://") ? image.src : "",
      element,
    });
  });
  return items;
}

function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

function idString(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asConversation(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  let title = firstString(obj, ["nickname", "nickName", "userName", "username", "displayName", "remarkName", "conversationName"]);
  if (!title) {
    for (const key of ["coreInfo", "userInfo", "user", "toUser", "participant"]) {
      const child = obj[key];
      if (!child || typeof child !== "object") continue;
      title = firstString(child, ["nickname", "nickName", "userName", "username", "displayName", "remarkName", "name"]);
      if (title) break;
    }
  }
  if (!title || title.length > 32 || BLOCK.has(title)) return null;
  const id = idString(obj, ["conversationId", "conversation_id", "conversationShortId", "chatId", "chatUserId", "sessionId", "userId", "uid"]);
  const marked = ["conversationId", "conversation_id", "conversationShortId", "chatId", "chatUserId", "sessionId", "lastMsgContent", "lastMessage", "lastMsg", "unreadCount", "unread"].some((key) => obj[key] != null && obj[key] !== "");
  if (!id || !marked) return null;
  const avatar = firstString(obj, ["avatar", "avatarUrl", "avatarUri"]);
  return {
    id,
    title,
    preview: firstString(obj, ["lastMsgContent", "lastMessage", "lastMsg", "previewText", "preview"]).slice(0, 80),
    time: firstString(obj, ["lastTime", "time", "timestamp", "updateTimeText"]),
    unread: Number(obj.unreadCount || obj.unread || obj.unreadNum || 0) || 0,
    avatar: avatar.startsWith("https://") ? avatar : "",
    element: null,
  };
}

function messageText(obj) {
  if (typeof obj.text === "string") return obj.text;
  if (obj.content && typeof obj.content === "object") return firstString(obj.content, ["text", "content"]);
  if (typeof obj.content !== "string") return "";
  const raw = obj.content.trim();
  if (!raw.startsWith("{")) return raw;
  try {
    return firstString(JSON.parse(raw), ["text", "content"]) || raw;
  } catch (error) {
    return raw;
  }
}

function asMessage(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const id = firstString(obj, ["messageId", "msgId", "serverMessageId", "clientMessageId"]);
  if (!id) return null;
  const text = messageText(obj).replace(/\s+/g, " ").trim();
  if (!text || text.length > 2000) return null;
  const fromMe = obj.fromMe === true || obj.isSelf === true || obj.isFromMe === true || obj.direction === 1 || obj.flow === "out";
  return { id, text, fromMe: Boolean(fromMe), time: firstString(obj, ["time", "createTime", "createdAt"]) };
}

function walkValue(value, depth, state) {
  if (!value || typeof value !== "object" || depth > 6 || value.nodeType || state.seen.has(value)) return;
  state.seen.add(value);
  const conversation = asConversation(value);
  if (conversation) state.conversations.push(conversation);
  const message = asMessage(value);
  if (message) state.messages.push(message);
  if (state.count > 8000) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < Math.min(value.length, 30); index += 1) walkValue(value[index], depth + 1, state);
    return;
  }
  for (const key of Object.keys(value).slice(0, 25)) {
    if (key === "child" || key === "sibling" || key === "return" || key === "alternate" || key === "stateNode") continue;
    state.count += 1;
    try {
      walkValue(value[key], depth + 1, state);
    } catch (error) {
      continue;
    }
  }
}

function fiberCollect(rootEl) {
  const state = { count: 0, seen: new Set(), conversations: [], messages: [] };
  const roots = [];
  if (rootEl) roots.push(rootEl);
  else {
    for (const doc of allDocs()) roots.push(doc.getElementById("root") || doc.getElementById("app") || doc.body);
  }
  const stack = [];
  for (const root of roots) {
    if (!root) continue;
    const key = Object.keys(root).find((item) => item.startsWith("__reactContainer$") || item.startsWith("__reactFiber$"));
    if (key) stack.push(root[key]);
  }
  if (!stack.length) return state;
  const fibers = new Set();
  while (stack.length && state.count < 8000) {
    const fiber = stack.pop();
    if (!fiber || typeof fiber !== "object" || fibers.has(fiber)) continue;
    fibers.add(fiber);
    try {
      walkValue(fiber.memoizedProps, 0, state);
      walkValue(fiber.memoizedState, 0, state);
    } catch (error) {
      continue;
    }
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  return state;
}

function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.id || item.title;
    if (!item.title || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.slice(0, 120);
}

function mergeConversations(domItems, fiberItems) {
  const fiber = dedupe(fiberItems);
  if (!domItems.length && fiber.length) return fiber;
  if (fiber.length >= 2 && fiber.length >= domItems.length) return fiber;
  const byTitle = new Map(fiber.map((item) => [item.title, item]));
  return dedupe(
    domItems.map((item) => {
      const match = byTitle.get(item.title);
      if (!match) return item;
      return Object.assign({}, item, {
        id: match.id || item.id,
        preview: item.preview || match.preview,
        unread: item.unread || match.unread,
        avatar: item.avatar || match.avatar,
        time: item.time || match.time,
      });
    }),
  );
}

function messageRegion() {
  const selectors = [
    "[class*='chat-content']",
    "[class*='chat-area']",
    "[class*='message-list']",
    "[class*='msg-list']",
    "[class*='conversation-content']",
    "[class*='MessageList']",
    "[class*='messageList']",
  ];
  for (const selector of selectors) {
    const sized = queryAll(selector).find((el) => visible(el) && el.getBoundingClientRect().width > 280);
    if (sized) return sized;
  }
  return null;
}


function scrollable(el) {
  if (!el) return null;
  const nodes = [el, ...el.querySelectorAll("*")];
  let best = null;
  let bestExtra = 24;
  for (const node of nodes) {
    const extra = node.scrollHeight - node.clientHeight;
    if (extra > bestExtra && node.clientHeight > 80) {
      best = node;
      bestExtra = extra;
    }
  }
  if (best) return best;
  let node = el.parentElement;
  for (let depth = 0; node && depth < 6; depth += 1) {
    if (node.scrollHeight > node.clientHeight + 24) return node;
    node = node.parentElement;
  }
  return el;
}

function scrollList(direction) {
  const list = queryAll("[class*='conversationConversationListwrapper'], [class*='ConversationList']").find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.height > 200 && rect.width > 160 && rect.width < 560;
  });
  const el = list ? scrollable(list) : null;
  if (!el) return { moved: false, atEnd: true };
  const before = el.scrollTop;
  if (direction === "top") el.scrollTop = 0;
  else el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(220, el.clientHeight * 0.8));
  return {
    moved: Math.abs(el.scrollTop - before) > 2,
    atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 12,
  };
}

function computedStyle(el) {
  const view = el && el.ownerDocument && el.ownerDocument.defaultView;
  return view ? view.getComputedStyle(el) : null;
}

function scrollableStyle(style) {
  if (!style) return false;
  return style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "overlay";
}

function messageListBox() {
  const named = queryAll("[class*='messageMessageListlist'], [class*='messageList'], [class*='MessageList']").filter((el) => {
    const rect = el.getBoundingClientRect();
    return visible(el) && rect.width > 280 && rect.height > 160;
  });
  named.sort((a, b) => {
    const an = String(a.className || "").includes("messageMessageListlist") ? 0 : 1;
    const bn = String(b.className || "").includes("messageMessageListlist") ? 0 : 1;
    if (an !== bn) return an - bn;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return br.width * br.height - ar.width * ar.height;
  });
  return named[0] || messageRegion();
}

function scrollerCandidates(seed) {
  const found = [];
  const listRect = seed ? seed.getBoundingClientRect() : null;
  const push = (el) => {
    if (!el || found.includes(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 180 || rect.height < 80) return;
    if (listRect) {
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < listRect.left - 24 || x > listRect.right + 24 || y < listRect.top - 48 || y > listRect.bottom + 48) return;
    }
    found.push(el);
  };
  if (!seed) return found;
  push(seed);
  for (const child of seed.querySelectorAll("*")) push(child);
  let parent = seed.parentElement;
  for (let depth = 0; parent && depth < 5; depth += 1) {
    push(parent);
    parent = parent.parentElement;
  }
  return found;
}

function scoreScroller(el) {
  const style = computedStyle(el);
  const extra = el.scrollHeight - el.clientHeight;
  const reversed = style && (style.flexDirection === "column-reverse" || style.flexDirection === "row-reverse");
  let score = 0;
  if (scrollableStyle(style)) score += 120;
  if (reversed) score += 40;
  if (extra > 20) score += Math.min(extra, 1600) / 10;
  if (String(el.className || "").includes("messageMessageListlist")) score += 90;
  if (el.clientHeight > 200) score += 15;
  return score;
}

function scrollerInfo(el) {
  const style = computedStyle(el);
  const reversed = Boolean(style && (style.flexDirection === "column-reverse" || style.flexDirection === "row-reverse"));
  const rect = el.getBoundingClientRect();
  return {
    style,
    reversed,
    minTop: Math.min(0, el.clientHeight - el.scrollHeight),
    maxTop: Math.max(0, el.scrollHeight - el.clientHeight),
    x: rect.left + Math.min(Math.max(rect.width * 0.62, 48), Math.max(rect.width - 20, 48)),
    y: rect.top + rect.height * 0.42,
  };
}

function applyScroll(el, top) {
  const previous = el.style.scrollBehavior;
  el.style.scrollBehavior = "auto";
  try {
    el.scrollTop = top;
    el.scrollTo(0, top);
  } catch (error) {
    el.scrollTop = top;
  }
  el.style.scrollBehavior = previous;
}

function scrollOne(el, direction) {
  const info = scrollerInfo(el);
  const before = el.scrollTop;
  const step = Math.max(320, el.clientHeight * 0.92);
  let target = before;
  if (direction === "end") target = info.reversed ? 0 : info.maxTop;
  else if (info.reversed) target = direction === "down" ? Math.min(0, before + step) : Math.max(info.minTop, before - step);
  else if (direction === "down") target = Math.min(info.maxTop, before + step);
  else target = Math.max(info.minTop, before - step);
  applyScroll(el, target);
  if (!info.reversed && direction !== "down" && direction !== "end" && Math.abs(el.scrollTop - before) <= 2) {
    applyScroll(el, before - step);
  }
  wheelOn(el, direction === "down" ? 720 : -720);
  const top = el.scrollTop;
  return {
    found: true,
    moved: Math.abs(top - before) > 2,
    atTop: info.reversed ? top <= info.minTop + 4 : top <= 4,
    top: Math.round(top),
    height: Math.round(el.scrollHeight),
    client: Math.round(el.clientHeight),
    reversed: info.reversed || top < -2,
    overflow: info.style ? info.style.overflowY : "",
    flex: info.style ? info.style.flexDirection : "",
    x: Math.round(info.x),
    y: Math.round(info.y),
    className: String(el.className || "").slice(0, 80),
  };
}

function messageScroller() {
  const seed = messageListBox();
  const ranked = scrollerCandidates(seed).sort((a, b) => scoreScroller(b) - scoreScroller(a));
  return ranked[0] || seed || null;
}

function scrollMessages(direction) {
  const seed = messageListBox();
  const ranked = scrollerCandidates(seed).sort((a, b) => scoreScroller(b) - scoreScroller(a));
  const ordered = [];
  if (seed) ordered.push(seed);
  for (const el of ranked) {
    if (!ordered.includes(el)) ordered.push(el);
  }
  if (!ordered.length) return { found: false, moved: false, atTop: true };
  let fallback = null;
  for (const el of ordered.slice(0, 8)) {
    const attempt = scrollOne(el, direction);
    if (!fallback) fallback = attempt;
    if (attempt.moved) return attempt;
  }
  return fallback;
}

function scrollThreadToEnd() {
  const el = messageScroller();
  if (!el) return { scrolled: false };
  scrollOne(el, "end");
  return { scrolled: true };
}

function historyNudge() {
  const el = messageListBox() || messageScroller();
  const button = controlByLabel(["\u67e5\u770b\u66f4\u591a", "\u52a0\u8f7d\u66f4\u591a", "\u66f4\u591a\u6d88\u606f", "\u67e5\u770b\u5386\u53f2\u6d88\u606f", "\u5386\u53f2\u6d88\u606f"]);
  if (button) fireClick(button);
  const called = [];
  if (!el) return { found: false, clicked: Boolean(button), called };
  const interesting = /loadmore|loadprev|loadhistory|fetchmore|reachtop|scrolltoupper|onscroll|onwheel/i;
  const fiberKey = Object.keys(el).find((item) => item.startsWith("__reactFiber$") || item.startsWith("__reactInternalInstance$"));
  let fiber = fiberKey ? el[fiberKey] : null;
  const seen = new Set();
  for (let step = 0; fiber && step < 5; step += 1) {
    if (seen.has(fiber)) break;
    seen.add(fiber);
    const bags = [fiber.memoizedProps, fiber.pendingProps, fiber.stateNode];
    for (const bag of bags) {
      if (!bag || typeof bag !== "object" || bag.nodeType) continue;
      for (const name of Object.keys(bag)) {
        if (typeof bag[name] !== "function" || called.includes(name) || !interesting.test(name)) continue;
        if (step > 0 && /^onscroll$|^onwheel$/i.test(name)) continue;
        try {
          bag[name]({
            deltaY: -560,
            deltaX: 0,
            target: el,
            currentTarget: el,
            preventDefault() {},
            stopPropagation() {},
            persist() {},
            nativeEvent: { deltaY: -560 },
          });
          called.push(name);
        } catch (error) {
          called.push(name + "!");
        }
      }
    }
    fiber = fiber.return;
  }
  return { found: true, clicked: Boolean(button), called: called.slice(0, 8) };
}

function messageTextOf(el) {
  return linesOf(el).filter((line) => !/^\d{1,2}:\d{2}$/.test(line)).join(" ").trim();
}

function contentImage(node) {
  const images = [...node.querySelectorAll("img")].filter((img) => {
    if (!visible(img)) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 48) return false;
    const name = String(img.className || "").toLowerCase();
    return !name.includes("avatar") && !name.includes("emoji");
  });
  return images[0] || null;
}
function contentNode(node, text) {
  let best = node;
  let bestWidth = node.getBoundingClientRect().width;
  for (const el of node.querySelectorAll("div, p, span, pre")) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 10 || rect.width > bestWidth - 6) continue;
    if (messageTextOf(el) !== text) continue;
    best = el;
    bestWidth = rect.width;
  }
  return best;
}

function markedSide(el) {
  const name = String((el && el.className) || "");
  const data = el && el.dataset ? Object.keys(el.dataset).concat(Object.values(el.dataset)).join(" ") : "";
  const hint = name + " " + data;
  if (/(incoming|from-?other|receive|msg-?left|message-?left|is-?left)/i.test(hint)) return "them";
  if (/(self|mine|outgoing|from-?me|is-?me|is-?self|from-?self|msg-?right|message-?right|is-?right|sender)/i.test(hint)) return "me";
  if (/(^|[^a-z])left([^a-z]|$)/i.test(name)) return "them";
  if (/(^|[^a-z])right([^a-z]|$)/i.test(name)) return "me";
  return "";
}

function styledSide(el) {
  const view = el && el.ownerDocument && el.ownerDocument.defaultView;
  if (!view) return "";
  const style = view.getComputedStyle(el);
  if (style.marginLeft === "auto" && style.marginRight !== "auto") return "me";
  if (style.marginRight === "auto" && style.marginLeft !== "auto") return "them";
  if (style.alignSelf === "flex-end" || style.alignSelf === "end" || style.float === "right") return "me";
  if (style.float === "left") return "them";
  if (style.textAlign === "right" || style.textAlign === "end") return "me";
  const parent = el.parentElement;
  if (!parent) return "";
  const parentStyle = view.getComputedStyle(parent);
  if (parentStyle.marginLeft === "auto" && parentStyle.marginRight !== "auto") return "me";
  if (parentStyle.textAlign === "right" || parentStyle.textAlign === "end") return "me";
  if (parentStyle.flexDirection === "row-reverse") return "me";
  const row = parentStyle.flexDirection === "row" || parentStyle.flexDirection === "row-reverse";
  if (!row) return "";
  if (parentStyle.justifyContent === "flex-end" || parentStyle.justifyContent === "end") return "me";
  return "";
}

function fromMeMessage(box, rect, regionRect) {
  let el = box;
  for (let depth = 0; el && depth < 3; depth += 1) {
    const marked = markedSide(el);
    if (marked) return marked === "me";
    const styled = styledSide(el);
    if (styled) return styled === "me";
    el = el.parentElement;
  }
  const leftGap = rect.left - regionRect.left;
  const rightGap = regionRect.right - rect.right;
  return rightGap + 16 < leftGap;
}

function domMessages() {
  const region = messageRegion();
  const selectors = ["[class*='message-item']", "[class*='chat-message']", "[class*='msg-item']", "[class*='bubble']", "[class*='MessageBoxContentrowBox']", "[class*='MessageItemTextcontainer']", "[class*='MessageItemImageImageBox']"];
  let nodes = [];
  for (const selector of selectors) {
    const found = region ? [...region.querySelectorAll(selector)] : queryAll(selector);
    const usable = found.filter((el) => {
      if (!visible(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.height >= 12 && rect.height <= 420 && rect.width >= 24;
    });
    if (usable.length) {
      nodes = usable;
      break;
    }
  }
  const deepest = nodes.filter((el) => !nodes.some((other) => other !== el && el.contains(other)));
  const prepared = [];
  for (const node of deepest) {
    const lines = linesOf(node);
    const time = lines.find((line) => /^\d{1,2}:\d{2}$/.test(line)) || "";
    let text = lines.filter((line) => line !== time).join(" ").trim();
    const shot = contentImage(node);
    if (!text && shot) text = "[\u56fe\u7247]";
    if (!text || BLOCK.has(text)) continue;
    const box = contentNode(node, text);
    const srcUrl = shot ? String(shot.currentSrc || shot.src || "") : "";
    prepared.push({
      box,
      rect: box.getBoundingClientRect(),
      text,
      time,
      image: srcUrl.startsWith("https://") ? srcUrl : "",
    });
  }
  let left = Infinity;
  let right = -Infinity;
  for (const item of prepared) {
    left = Math.min(left, item.rect.left);
    right = Math.max(right, item.rect.right);
  }
  const regionRect = right > left ? { left, right } : { left: 0, right: window.innerWidth };
  if (location.hostname.indexOf("douyin") >= 0) prepared.reverse();
  const messages = [];
  const seen = new Set();
  for (const item of prepared) {
    const key = Math.round(item.rect.top) + "|" + Math.round(item.rect.left) + "|" + item.text;
    if (seen.has(key)) continue;
    seen.add(key);
    const fromMe = fromMeMessage(item.box, item.rect, regionRect);
    messages.push({ id: messages.length + "-" + item.text.slice(0, 12), text: item.text.slice(0, 2000), fromMe, time: item.time, image: item.image || "" });
  }
  return messages.slice(-80);
}

function fireClick(el) {
  const view = el.ownerDocument && el.ownerDocument.defaultView;
  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    view: view,
    clientX: rect.left + Math.max(rect.width, 8) / 2,
    clientY: rect.top + Math.max(rect.height, 8) / 2,
  };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
  } catch (error) {
    // Older documents may not expose PointerEvent.
  }
  el.click();
}

function douyinLabel(row) {
  const nodes = [...row.querySelectorAll("[class*='conversationConversationItemtitle']")];
  const titles = nodes.filter((el) => {
    const name = String(el.className || "");
    return name.includes("conversationConversationItemtitle") && !name.includes("Wrapper") && !name.includes("Tag");
  });
  const source = titles.length ? titles : nodes;
  let best = "";
  for (const el of source) {
    const label = ((el.innerText || "").split("\n").map((line) => line.trim()).find(Boolean) || "").replace(/\s+/g, " ");
    if (label && (!best || label.length < best.length)) best = label;
  }
  return best;
}

function douyinRow(title) {
  const wanted = String(title || "").replace(/\s+/g, " ").trim();
  if (!wanted) return null;
  const rows = queryAll("[class*='conversationConversationItemwrapper']").filter((el) => douyinLabel(el) === wanted);
  rows.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return ar.width * ar.height - br.width * br.height;
  });
  return rows[0] || null;
}

function openDouyinConversation(title) {
  if (!title || location.hostname.indexOf("douyin") < 0) return false;
  const row = douyinRow(title);
  if (!row) return false;
  fireClick(row);
  return true;
}

function openConversation(id, title) {
  for (const element of queryAll("[data-easy-id]")) {
    if (element.getAttribute("data-easy-id") === id) {
      element.click();
      return true;
    }
  }
  if (!title) return false;
  const named = exactVisible([title]);
  if (named) {
    named.click();
    return true;
  }
  for (const element of queryAll("[data-easy-id]")) {
    if (linesOf(element).includes(title)) {
      element.click();
      return true;
    }
  }
  for (const element of heuristicRows()) {
    if (linesOf(element).includes(title)) {
      element.click();
      return true;
    }
  }
  return false;
}

function editorProbe() {
  const frames = [];
  for (const frame of document.querySelectorAll("iframe")) {
    let access = "ok";
    let href = "";
    try {
      href = frame.contentDocument && frame.contentDocument.location ? frame.contentDocument.location.href : "";
    } catch (error) {
      access = "blocked";
    }
    const rect = frame.getBoundingClientRect();
    frames.push({
      src: String(frame.src || "").slice(0, 160),
      access: access,
      href: String(href || "").slice(0, 160),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });
  }
  const interesting = [];
  const seen = new Set();
  const selectors = ["textarea", "[contenteditable]", "[role='textbox']", "[data-placeholder]", "[class*='input']", "[class*='Input']", "[class*='editor']", "[class*='Editor']", "[class*='ace-line']"];
  for (const doc of allDocs()) {
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = doc.querySelectorAll(selector);
      } catch (error) {
        continue;
      }
      for (const el of nodes) {
        if (seen.has(el) || interesting.length >= 30) continue;
        const className = String(el.className || "");
        const placeholder = el.getAttribute("data-placeholder") || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
        if (!/input|editor|textarea|ace|kit|text|placeholder|send|msg/i.test(className + placeholder) && el.tagName !== "TEXTAREA" && !el.isContentEditable) continue;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        interesting.push({
          tag: el.tagName,
          className: className.slice(0, 90),
          placeholder: String(placeholder).slice(0, 40),
          editable: Boolean(el.isContentEditable),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }
  }
  const classes = [];
  const seenClass = new Set();
  for (const el of document.querySelectorAll("[class]")) {
    const name = String(el.className || "");
    if (!/conversation|message|chat|inputArea|editor|MsgInput|ace-line/i.test(name)) continue;
    const key = name.slice(0, 80);
    if (seenClass.has(key) || classes.length >= 40) continue;
    seenClass.add(key);
    const rect = el.getBoundingClientRect();
    classes.push({ className: key, w: Math.round(rect.width), h: Math.round(rect.height) });
  }
  return {
    url: location.href,
    title: document.title,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visibility: document.visibilityState,
    frames: frames.slice(0, 8),
    interesting: interesting,
    classes: classes,
    titles: [...document.querySelectorAll("[class*='conversationConversationItemtitle']")].slice(0, 8).map((el) => (el.innerText || "").trim()),
  };
}

function focusComposer() {
  const hints = ["\u53d1\u9001\u6d88\u606f", "\u8f93\u5165\u6d88\u606f", "\u8bf4\u70b9\u4ec0\u4e48", "\u53d1\u6d88\u606f", "\u6309\u56de\u8f66\u53d1\u9001"];
  const nodes = queryAll("div,span,p,textarea,pre,label").filter((el) => {
    if (!visible(el)) return false;
    const text = ((el.innerText || "") + " " + (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\s+/g, " ").trim();
    if (!text || text.length > 24) return false;
    return hints.some((hint) => text.indexOf(hint) >= 0);
  });
  nodes.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
  if (!nodes[0]) return false;
  nodes[0].click();
  return true;
}

function editorRoots() {
  const roots = [];
  const visit = (root) => {
    if (!root || roots.indexOf(root) >= 0) return;
    roots.push(root);
    let nodes = [];
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    } catch (error) {
      nodes = [];
    }
    for (const el of nodes) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  for (const doc of allDocs()) visit(doc);
  return roots;
}

function editorHint(el) {
  const bits = [
    el.getAttribute("placeholder") || "",
    el.getAttribute("aria-label") || "",
    el.getAttribute("data-placeholder") || "",
    String(el.className || ""),
  ];
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 4; depth += 1) {
    bits.push(String(parent.className || ""));
    parent = parent.parentElement;
  }
  return bits.join(" ");
}

function collectEditors() {
  const selectors = [
    ".xhs-im-input-bar-editor",
    "[data-contents='true']",
    ".public-DraftEditor-content",
    "[data-slate-editor='true']",
    "[contenteditable]",
    "[role='textbox']",
    "[class*='messageEditorinputArea']",
    "[class*='inputArea']",
    "[class*='editor-kit-container']",
    "[class*='ace-line']",
    "[class*='imChatEditor']",
    "[class*='MsgInput']",
    "textarea",
    "[class*='chat-input'] [contenteditable]",
    "[class*='ChatInput'] [contenteditable]",
    "[class*='im-richtext']",
    "[class*='editor-kit']",
    "[class*='DraftEditor']",
  ];
  const seen = new Set();
  const found = [];
  for (const root of editorRoots()) {
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = root.querySelectorAll(selector);
      } catch (error) {
        continue;
      }
      for (const el of nodes) {
        if (seen.has(el)) continue;
        const rect = el.getBoundingClientRect();
        const hint = editorHint(el);
        const named = /messageEditor|inputArea|editor-kit|ace-line|imChatEditor|MsgInput|xhs-im-input/i.test(hint);
        if (!named && (rect.width < 48 || rect.height < 10)) continue;
        const editable = el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.getAttribute("role") === "textbox";
        if (!editable && !/input|editor|composer|richtext|draft|textbox/i.test(hint)) continue;
        if (/search|\u641c\u7d22/i.test(hint) && !/\u53d1\u9001|\u6d88\u606f|editor|composer/i.test(hint)) continue;
        seen.add(el);
        found.push(el);
      }
    }
  }
  return found;
}

function editorScore(el) {
  const rect = el.getBoundingClientRect();
  const hint = editorHint(el);
  const view = el.ownerDocument && el.ownerDocument.defaultView;
  let score = rect.width * Math.min(rect.height, 120);
  if (/messageEditorinputArea|inputArea|ace-line/i.test(hint)) score += 5000000;
  if (/input|editor|composer|richtext|draft|textbox|chat-input|msg-input/i.test(hint)) score += 1000000;
  if (/\u53d1\u9001|\u6d88\u606f|\u8bf4\u70b9/.test(hint)) score += 800000;
  if (el.getAttribute("role") === "textbox" || el.isContentEditable) score += 200000;
  if (view && rect.top > view.innerHeight * 0.4) score += 400000;
  if (visible(el)) score += 100000;
  return score;
}

function findEditor() {
  let found = collectEditors();
  if (!found.length && focusComposer()) found = collectEditors();
  if (!found.length) return null;
  found.sort((a, b) => editorScore(b) - editorScore(a));
  return found[0];
}

function editorValue(editor) {
  return String(editor.value || editor.innerText || editor.textContent || "");
}

function placeCaret(editor) {
  const doc = editor.ownerDocument;
  editor.focus();
  if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
    const end = String(editor.value || "").length;
    try {
      editor.setSelectionRange(end, end);
    } catch (error) {
      return;
    }
    return;
  }
  const selection = doc.getSelection && doc.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function writeEditor(editor, text) {
  placeCaret(editor);
  const tag = editor.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") {
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const next = editor.value ? editor.value + text : text;
    if (desc && desc.set) desc.set.call(editor, next);
    else editor.value = next;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    return editor.value.indexOf(text) >= 0;
  }
  try {
    editor.ownerDocument.execCommand("insertText", false, text);
  } catch (error) {
    // Some editors reject the command until the caret is placed again.
  }
  if (editorValue(editor).indexOf(text) < 0) {
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    } catch (error) {
      // Ignore synthetic paste failures.
    }
  }
  if (editorValue(editor).indexOf(text) < 0) {
    editor.textContent = (editor.textContent || "") + text;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  }
  return editorValue(editor).indexOf(text) >= 0;
}

function insertText(text) {
  let editor = findEditor();
  if (!editor && focusComposer()) editor = findEditor();
  if (!editor || !text) return { filled: false, found: Boolean(editor) };
  return { filled: writeEditor(editor, text), found: true, via: editor.className || editor.tagName };
}

function insertCommand(text) {
  const editor = findEditor();
  if (!editor || !text) return { filled: false, found: Boolean(editor) };
  return { filled: writeEditor(editor, text), found: true, via: "command" };
}

function editorFilled(text) {
  const editor = findEditor();
  if (!editor) return { filled: false, found: false };
  return { filled: editorValue(editor).indexOf(text) >= 0, found: true };
}

function fileFromPayload(payload) {
  const raw = String(payload.data || "");
  const mime = String(payload.mime || "image/png");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const name = String(payload.name || "image.png").replace(/[\\/]/g, "");
  return new File([bytes], name || "image.png", { type: mime });
}

function assignFile(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
  if (desc && desc.set) desc.set.call(input, transfer.files);
  else input.files = transfer.files;
  const tracker = input._valueTracker;
  if (tracker && tracker.setValue) tracker.setValue("");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return Boolean(input.files && input.files.length);
}

function imageInputs(root) {
  const scope = root ? [...root.querySelectorAll("input[type='file']")] : queryAll("input[type='file']");
  return scope.filter((el) => {
    const accept = (el.getAttribute("accept") || "").toLowerCase();
    if (!accept) return true;
    return /image|png|jpe?g|gif|webp|\*/.test(accept);
  });
}

function composerRoot(editor) {
  let el = editor;
  for (let depth = 0; el && depth < 8; depth += 1) {
    if (el.querySelector && el.querySelector("input[type='file']")) return el;
    el = el.parentElement;
  }
  return editor ? editor.parentElement : null;
}

function isImageControl(el) {
  if (!el || el.tagName === "LABEL") return false;
  const label = [el.getAttribute("aria-label") || "", el.getAttribute("title") || "", el.getAttribute("data-e2e") || ""].join(" ");
  if (/\u56fe\u7247|\u56fe\u50cf|\u7167\u7247|\u76f8\u518c|image|photo|picture|upload/i.test(label)) return true;
  return /FileUpload|inputActionIcon|iconAction|image-upload|upload-img|pic-icon|icon-image|btn-image|picture/i.test(String(el.className || ""));
}

function findImageButton(editor) {
  const candidates = queryAll("button,[role='button'],div,span").filter((el) => {
    if (!visible(el) || !isImageControl(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 12 && rect.width <= 72 && rect.height >= 12 && rect.height <= 72;
  });
  const deepest = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  if (!deepest.length) return null;
  if (!editor) return deepest[0];
  const editorRect = editor.getBoundingClientRect();
  deepest.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return Math.abs(ar.top - editorRect.bottom) + Math.abs(ar.left - editorRect.left) - (Math.abs(br.top - editorRect.bottom) + Math.abs(br.left - editorRect.left));
  });
  return deepest[0];
}

function pasteImage(file) {
  const editor = findEditor();
  if (!editor) return false;
  editor.focus();
  try {
    const data = new DataTransfer();
    data.items.add(file);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    return editor.getAttribute("contenteditable") === "true";
  } catch (error) {
    return false;
  }
}

function chatComposer(editor) {
  if (!editor || !editor.closest) return null;
  return editor.closest("[class*='imChatEditor'], [class*='messageEditor'], [class*='MsgInput'], [class*='chat-editor'], [class*='chatEditor'], [class*='message-input'], [class*='chat-input']");
}

function closeToEditor(el, editor) {
  if (!editor) return false;
  const editorRect = editor.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const vertical = rect.top - editorRect.bottom;
  const horizontal = Math.min(Math.abs(rect.left - editorRect.left), Math.abs(rect.right - editorRect.right));
  return vertical > -120 && vertical < 280 && horizontal < 720;
}

function composerFileInput(editor) {
  const root = chatComposer(editor) || composerRoot(editor);
  const pool = imageInputs(null).filter((el) => (root && root.contains(el)) || closeToEditor(el, editor));
  if (!pool.length) return null;
  if (!editor || pool.length === 1) return pool[0];
  const editorRect = editor.getBoundingClientRect();
  pool.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return Math.abs(ar.top - editorRect.bottom) + Math.abs(ar.left - editorRect.left) - (Math.abs(br.top - editorRect.bottom) + Math.abs(br.left - editorRect.left));
  });
  return pool[0];
}

function clickImageButton(file, editor) {
  const button = findImageButton(editor);
  if (button) {
    const host = button.closest ? button.closest("label") : null;
    const inner = host ? host.querySelector("input[type='file']") : null;
    if (inner && assignFile(inner, file)) return { attached: true, via: "button" };
  }
  const proto = HTMLInputElement.prototype;
  const original = proto.click;
  let attached = false;
  proto.click = function () {
    if (this && this.type === "file") {
      attached = assignFile(this, file) || attached;
      return;
    }
    return original.apply(this, arguments);
  };
  try {
    if (button) button.click();
  } finally {
    proto.click = original;
  }
  if (attached) return { attached: true, via: "button" };
  if (pasteImage(file)) return { attached: true, via: "paste" };
  return { attached: false, via: "" };
}

function imageStaged() {
  const modal = queryAll("[class*='SendFileModal'], [class*='btnSure'], .xhs-im-media-preview-dialog, .xhs-im-media-preview-overlay").some(visible);
  const editor = findEditor();
  let preview = false;
  if (editor) {
    const images = [...editor.querySelectorAll("img"), ...queryAll("img").filter((img) => closeToEditor(img, editor))];
    preview = images.some((img) => {
      if (!visible(img)) return false;
      const name = String(img.className || "").toLowerCase();
      if (name.includes("emoji") || name.includes("avatar")) return false;
      const rect = img.getBoundingClientRect();
      return rect.width >= 36 && rect.height >= 36;
    });
  }
  return { staged: Boolean(modal || preview), modal: Boolean(modal), preview: Boolean(preview) };
}

function confirmImage() {
  const xhsConfirm = queryAll(".xhs-im-media-preview-btn-confirm").filter((el) => visible(el) && !el.disabled);
  if (xhsConfirm[0]) {
    xhsConfirm[0].click();
    return { clicked: true, usedEnter: false, via: "xhs-confirm" };
  }
  const sure = queryAll("[class*='btnSure']").filter(visible);
  const button = sure.filter((el) => !sure.some((other) => other !== el && el.contains(other)))[0];
  if (button) {
    button.click();
    return { clicked: true, usedEnter: false, via: "modal" };
  }
  const sent = clickSend(false);
  if (sent.clicked) return sent;
  if (imageStaged().preview) return clickSend(true);
  return sent;
}

function nearestInput(inputs, editor) {
  if (!editor || inputs.length < 2) return inputs[0] || null;
  let best = inputs[0];
  let bestDistance = Infinity;
  for (const input of inputs) {
    let distance = 0;
    let node = editor;
    let found = false;
    while (node && distance < 12) {
      if (node.contains(input)) {
        found = true;
        break;
      }
      node = node.parentElement;
      distance += 1;
    }
    if (found && distance < bestDistance) {
      best = input;
      bestDistance = distance;
    }
  }
  return best;
}
function insertImage(payload) {
  const file = fileFromPayload(payload);
  if (location.hostname.indexOf("xiaohongshu") >= 0 && xhsImageSender(file)) {
    return { attached: true, via: "xhs", direct: true };
  }
  const editor = findEditor();
  if (!payload.buttonOnly) {
    const input = composerFileInput(editor);
    if (input && assignFile(input, file)) return { attached: true, via: "file" };
  }
  return clickImageButton(file, editor);
}

function xhsImageSender(file) {
  const fn = findXhsImageHandler();
  if (!fn) return false;
  try {
    const result = fn(file);
    if (result && typeof result.then === "function") result.catch(function () {});
    return true;
  } catch (error) {
    return false;
  }
}

function xhsHandlerScore(fn) {
  let source = "";
  try {
    source = Function.prototype.toString.call(fn);
  } catch (error) {
    return 0;
  }
  if (source.indexOf("insertLocalImage") >= 0 || source.indexOf("uploadImage") >= 0) return 3;
  if (source.indexOf("imageSelect") >= 0) return 2;
  return 1;
}

function walkVue(vnode, visit, seen, depth) {
  if (!vnode || typeof vnode !== "object" || depth > 50 || seen.has(vnode)) return;
  seen.add(vnode);
  if (vnode.suspense && vnode.suspense.activeBranch) walkVue(vnode.suspense.activeBranch, visit, seen, depth + 1);
  if (vnode.component) {
    visit(vnode.component);
    walkVue(vnode.component.subTree, visit, seen, depth + 1);
  }
  const children = vnode.children;
  if (Array.isArray(children)) {
    for (const child of children) walkVue(child, visit, seen, depth + 1);
  }
  if (Array.isArray(vnode.dynamicChildren)) {
    for (const child of vnode.dynamicChildren) walkVue(child, visit, seen, depth + 1);
  }
}

function findXhsImageHandler() {
  const hosts = [];
  for (const doc of allDocs()) hosts.push(doc.getElementById("app"), doc.getElementById("root"), doc.body);
  const roots = [];
  for (const host of hosts) {
    if (!host) continue;
    if (host._vnode) roots.push(host._vnode);
    const app = host.__vue_app__;
    if (app && app._container && app._container._vnode) roots.push(app._container._vnode);
  }
  let best = null;
  let bestScore = 0;
  const seen = new Set();
  for (const root of roots) {
    walkVue(root, (inst) => {
      const props = inst.props || {};
      const vnodeProps = inst.vnode && inst.vnode.props || {};
      const candidates = [props.onImageSelect, vnodeProps.onImageSelect, inst.setupState && inst.setupState.handleImageSelect];
      for (const fn of candidates) {
        if (typeof fn !== "function") continue;
        const score = xhsHandlerScore(fn);
        if (score > bestScore) {
          best = fn;
          bestScore = score;
        }
      }
    }, seen, 0);
  }
  return bestScore > 0 ? best : null;
}

function openXhsConversation(title) {
  if (!title || location.hostname.indexOf("xiaohongshu") < 0) return false;
  const rows = queryAll("[data-conv-id]").filter((el) => (el.innerText || "").indexOf(title) >= 0);
  const row = rows.filter((el) => !rows.some((other) => other !== el && el.contains(other)))[0] || rows[0];
  if (row) {
    row.click();
    return true;
  }
  const hosts = [];
  for (const doc of allDocs()) hosts.push(doc.getElementById("app"), doc.body);
  const roots = [];
  for (const host of hosts) if (host && host._vnode) roots.push(host._vnode);
  let opened = false;
  const seen = new Set();
  for (const root of roots) {
    walkVue(root, (inst) => {
      if (opened) return;
      const type = inst.type || {};
      if ((type.name || type.__name) !== "ConversationItem") return;
      const conv = inst.props && inst.props.conv;
      const label = conv && String(conv.name || "");
      if (!label || (label !== title && label.indexOf(title) < 0)) return;
      if (typeof inst.emit === "function") {
        inst.emit("click", conv);
        opened = true;
      }
    }, seen, 0);
  }
  return opened;
}

function xhsProbe() {
  const hosts = [];
  for (const doc of allDocs()) hosts.push(doc.getElementById("app"), doc.getElementById("root"), doc.body);
  let roots = 0;
  let components = 0;
  const names = [];
  let handlers = 0;
  const interesting = [];
  const seen = new Set();
  for (const host of hosts) {
    if (!host) continue;
    const list = [];
    if (host._vnode) list.push(host._vnode);
    if (host.__vue_app__ && host.__vue_app__._container && host.__vue_app__._container._vnode) list.push(host.__vue_app__._container._vnode);
    for (const root of list) {
      roots += 1;
      walkVue(root, (inst) => {
        components += 1;
        const type = inst.type || {};
        const name = type.name || type.__name || "";
        if (name && names.length < 40 && names.indexOf(name) < 0 && /input|chat|im|media|message|conv/i.test(name)) names.push(name);
        const props = inst.props || {};
        const vnodeProps = inst.vnode && inst.vnode.props || {};
        if (typeof props.onImageSelect === "function" || typeof vnodeProps.onImageSelect === "function") handlers += 1;
        if ((name === "InputBar" || name === "ChatWindow" || name === "IMView") && interesting.length < 4) {
          const keys = Object.keys(vnodeProps).concat(Object.keys(props));
          interesting.push({ name: name, keys: keys.filter((key) => /image|select|send|file|media/i.test(key)).slice(0, 20) });
        }
      }, seen, 0);
    }
  }
  return {
    url: location.href,
    roots: roots,
    components: components,
    names: names,
    handlers: handlers,
    interesting: interesting,
    files: queryAll("input[type='file']").length,
    editor: queryAll(".xhs-im-input-bar-editor").length,
    bar: queryAll(".xhs-im-input-bar, .xhs-im-input-bar-wrap").length,
    frames: queryAll("iframe").length,
    frameSrc: queryAll("iframe").slice(0, 4).map((frame) => String(frame.src || "").slice(0, 140)),
  };
}
function clickSend(allowEnter) {
  const editor = findEditor();
  const buttons = queryAll("button,[role='button'],div,span").filter((el) => {
    if (!visible(el)) return false;
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (text === "\u53d1\u9001" || el.getAttribute("aria-label") === "\u53d1\u9001" || el.getAttribute("title") === "\u53d1\u9001") return true;
    const rect = el.getBoundingClientRect();
    return /publishBtn|publishRedBtn|sendBtn|send-btn/i.test(String(el.className || "")) && rect.width <= 160 && rect.height <= 72;
  });
  const deepest = buttons.filter((el) => !buttons.some((other) => other !== el && el.contains(other)));
  if (!deepest.length) {
    if (!allowEnter || !editor) return { clicked: false, usedEnter: false };
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    return { clicked: false, usedEnter: true };
  }
  let best = deepest[0];
  if (editor) {
    const editorRect = editor.getBoundingClientRect();
    deepest.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return Math.abs(ar.top - editorRect.bottom) + Math.abs(ar.left - editorRect.right) - (Math.abs(br.top - editorRect.bottom) + Math.abs(br.left - editorRect.right));
    });
    best = deepest[0];
  }
  best.click();
  return { clicked: true, usedEnter: false };
}

function publicConversation(item) {
  return {
    id: String(item.id || item.title),
    title: item.title,
    preview: item.preview || "",
    time: item.time || "",
    unread: Number(item.unread) || 0,
    avatar: item.avatar || "",
  };
}

function run(action) {
  if (!action || typeof action !== "object") throw new Error("bad-action");
  if (action.type === "detect") return pageInfo();
  if (action.type === "nudge-login") {
    const button = exactVisible(["\u767b\u5f55", "\u626b\u7801\u767b\u5f55"]);
    if (button) button.click();
    return { clicked: Boolean(button), page: pageInfo() };
  }
  if (action.type === "sync") {
    let nudged = false;
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (error) {
      // Ignore pages that disallow the event.
    }
    if (!action.passive && domConversations().length < 1) {
      const entry = controlByLabel(["\u6d88\u606f", "\u79c1\u4fe1"]) || exactVisible(["\u6d88\u606f", "\u79c1\u4fe1"]);
      if (entry) {
        entry.click();
        nudged = true;
      }
    }
    const domItems = domConversations();
    const fiber = fiberCollect();
    const conversations = mergeConversations(domItems, fiber.conversations);
    for (const item of conversations) {
      if (item.element) item.element.setAttribute("data-easy-id", String(item.id));
    }
    return { conversations: conversations.map(publicConversation), nudged, page: pageInfo() };
  }
  if (action.type === "douyin-row") {
    const row = douyinRow(String(action.title || ""));
    if (!row) return { found: false };
    const rect = row.getBoundingClientRect();
    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  if (action.type === "editor-probe") return editorProbe();
  if (action.type === "editor-ready") {
    const editor = findEditor();
    const rect = editor ? editor.getBoundingClientRect() : null;
    return {
      found: Boolean(editor),
      className: editor ? String(editor.className || "").slice(0, 80) : "",
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      width: rect ? Math.round(rect.width) : 0,
      height: rect ? Math.round(rect.height) : 0,
    };
  }
  if (action.type === "xhs-probe") return xhsProbe();
  if (action.type === "open") {
    const title = String(action.title || "");
    const opened = openXhsConversation(title) || openDouyinConversation(title) || openConversation(String(action.id || ""), title);
    return { opened: opened, page: pageInfo() };
  }
  if (action.type === "scroll-list") return scrollList(String(action.direction || "down"));
  if (action.type === "scroll-messages") return scrollMessages(String(action.direction || "up"));
  if (action.type === "history-nudge") return historyNudge();
  if (action.type === "conversations") return { conversations: domConversations().map(publicConversation) };
  if (action.type === "scroll-end") return scrollThreadToEnd();
  if (action.type === "messages") {
    const dom = domMessages();
    const fiber = dom.length ? { messages: [] } : fiberCollect(messageRegion() || document.body);
    return { messages: dom.length ? dom : fiber.messages.slice(-40), page: pageInfo() };
  }
  if (action.type === "insert") return insertText(String(action.text || ""));
  if (action.type === "insert-command") return insertCommand(String(action.text || ""));
  if (action.type === "editor-filled") return editorFilled(String(action.text || ""));
  if (action.type === "insert-image") return insertImage(action);
  if (action.type === "image-staged") return imageStaged();
  if (action.type === "confirm-image") return confirmImage();
  if (action.type === "click-send") return clickSend(action.allowEnter !== false);
  throw new Error("unknown-action");
}
