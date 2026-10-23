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

function pageInfo() {
  const loginButton = exactVisible(["\u767b\u5f55", "\u626b\u7801\u767b\u5f55"]);
  const headerLogin = Boolean(loginButton && loginButton.getBoundingClientRect().top < 180);
  const listed = queryAll("a[href*='/user/profile'], a[href*='/user/self'], [data-e2e='user-info']").find(visible) || null;
  const profile = listed || headerUserLink();
  const scanning = scanPending();
  let storageUser = false;
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
  const cookie = document.cookie || "";
  const hasSession = /(?:^|;\s*)(?:web_session|sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|passport_assist_user|login_time)=/.test(cookie) || /(?:^|;\s*)LOGIN_STATUS=(?:1|true)/i.test(cookie);
  const nickname = profileNickname(profile);
  const image = profile ? profile.querySelector("img") : null;
  const avatar = image && String(image.src || "").startsWith("https://") ? image.src : "";
  const loggedIn = Boolean(profile || storageUser || (hasSession && (!scanning || /passport_assist_user|login_time|sessionid/.test(cookie))));
  return {
    loggedIn,
    loginRequired: !loggedIn && (scanning || headerLogin),
    nickname,
    avatar,
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
  const timePattern = /^(\d{1,2}:\d{2}|\u6628\u5929|\u524d\u5929|\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5]|\d+\u5206\u949f\u524d|\d+\u5c0f\u65f6\u524d|\d{1,2}-\d{1,2})$/;
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
      id: title + "#" + index,
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
  return result.slice(0, 80);
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


function scrollThreadToEnd() {
  const region = messageRegion();
  const targets = [];
  if (region) targets.push(region);
  for (const doc of allDocs()) {
    if (doc.scrollingElement) targets.push(doc.scrollingElement);
    targets.push(...doc.querySelectorAll("[class*=message], [class*=chat], [class*=msg]"));
  }
  for (const el of targets) {
    try {
      el.scrollTop = el.scrollHeight;
    } catch (error) {
      continue;
    }
  }
  return { scrolled: true };
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
  const messages = [];
  const seen = new Set();
  for (const item of prepared) {
    const key = Math.round(item.rect.top) + "|" + Math.round(item.rect.left) + "|" + item.text;
    if (seen.has(key)) continue;
    seen.add(key);
    const fromMe = fromMeMessage(item.box, item.rect, regionRect);
    messages.push({ id: messages.length + "-" + item.text.slice(0, 12), text: item.text.slice(0, 2000), fromMe, time: item.time, image: item.image || "" });
  }
  return messages.slice(-40);
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

function findEditor() {
  const selectors = [
    ".xhs-im-input-bar-editor",
    "[data-contents='true']",
    ".DraftEditor-editor [contenteditable='true']",
    ".DraftEditor-root [contenteditable='true']",
    "textarea",
    "[contenteditable='true']",
  ];
  for (const selector of selectors) {
    const found = queryAll(selector).filter(visible);
    if (!found.length) continue;
    found.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    return found[0];
  }
  return null;
}

function editorValue(editor) {
  return String(editor.value || editor.innerText || "");
}

function insertText(text) {
  const editor = findEditor();
  if (!editor || !text) return { filled: false };
  editor.focus();
  const tag = editor.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") {
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (!desc || !desc.set) return { filled: false };
    desc.set.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    return { filled: editor.value.includes(text), via: "input" };
  }
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  } catch (error) {
    return { filled: false, via: "draft" };
  }
  return { filled: editorValue(editor).includes(text), via: "draft" };
}

function insertCommand(text) {
  const editor = findEditor();
  if (!editor || !text) return { filled: false };
  editor.focus();
  const ok = editor.ownerDocument.execCommand("insertText", false, text);
  return { filled: Boolean(ok) || editorValue(editor).includes(text), via: "command" };
}

function editorFilled(text) {
  const editor = findEditor();
  if (!editor) return { filled: false };
  return { filled: editorValue(editor).includes(text) };
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
  if (action.type === "xhs-probe") return xhsProbe();
  if (action.type === "open") {
    const title = String(action.title || "");
    const opened = openXhsConversation(title) || openConversation(String(action.id || ""), title);
    return { opened: opened, page: pageInfo() };
  }
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
