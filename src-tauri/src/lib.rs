use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const BRIDGE: &str = include_str!("bridge.js");

#[derive(Clone, Copy)]
enum Platform {
    Xhs,
    Douyin,
}

impl Platform {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "xhs" => Ok(Self::Xhs),
            "douyin" => Ok(Self::Douyin),
            _ => Err("\u{672a}\u{77e5}\u{5e73}\u{53f0}".into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Xhs => "xhs",
            Self::Douyin => "douyin",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::Xhs => "\u{5c0f}\u{7ea2}\u{4e66}",
            Self::Douyin => "\u{6296}\u{97f3}",
        }
    }

    fn hosts(self) -> &'static [&'static str] {
        match self {
            Self::Xhs => &["xiaohongshu.com"],
            Self::Douyin => &["douyin.com", "iesdouyin.com"],
        }
    }

    fn entry_url(self, entry: &str) -> &'static str {
        match (self, entry) {
            (Self::Xhs, "creator") => "https://creator.xiaohongshu.com/",
            (Self::Xhs, "messages") => "https://www.xiaohongshu.com/notification",
            (Self::Xhs, _) => "https://www.xiaohongshu.com/",
            (Self::Douyin, "messages") => "https://www.douyin.com/chat",
            (Self::Douyin, _) => "https://www.douyin.com/",
        }
    }

    fn is_message_url(self, url: &str) -> bool {
        match self {
            // /messages is a removed route and only shows a not-found page.
            Self::Douyin => url.contains("/chat") || url.contains("/im"),
            Self::Xhs => {
                url.contains("notification")
                    || url.contains("creator.xiaohongshu.com")
                    || url.contains("/im")
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Account {
    id: String,
    platform: String,
    bound: bool,
    nickname: String,
    avatar: String,
    bound_at: u64,
    last_sync_at: u64,
    last_error: String,
    message_url: String,
}

impl Default for Account {
    fn default() -> Self {
        Self {
            id: String::new(),
            platform: String::new(),
            bound: false,
            nickname: String::new(),
            avatar: String::new(),
            bound_at: 0,
            last_sync_at: 0,
            last_error: String::new(),
            message_url: String::new(),
        }
    }
}

impl Account {
    fn blank(&self) -> bool {
        self.id.is_empty() && !self.bound && self.nickname.is_empty() && self.avatar.is_empty()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct AccountsFile {
    slots: Vec<Account>,
    #[serde(default, skip_serializing_if = "Account::blank")]
    xhs: Account,
    #[serde(default, skip_serializing_if = "Account::blank")]
    douyin: Account,
}

impl Default for AccountsFile {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            xhs: Account::default(),
            douyin: Account::default(),
        }
    }
}

fn window_label(platform: Platform, account_id: &str) -> String {
    if account_id.is_empty() || account_id == "main" {
        platform.as_str().to_string()
    } else {
        format!("{}-{}", platform.as_str(), account_id)
    }
}

fn imported_slot(platform: Platform, legacy: &Account) -> Account {
    let mut account = legacy.clone();
    account.id = "main".into();
    account.platform = platform.as_str().into();
    account
}

impl AccountsFile {
    fn migrate(&mut self) {
        if self.slots.is_empty() {
            self.slots.push(imported_slot(Platform::Xhs, &self.xhs));
            self.slots
                .push(imported_slot(Platform::Douyin, &self.douyin));
        }
        self.xhs = Account::default();
        self.douyin = Account::default();
    }

    fn slot_mut(&mut self, platform: Platform, account_id: &str) -> Result<&mut Account, String> {
        self.slots
            .iter_mut()
            .find(|slot| slot.platform == platform.as_str() && slot.id == account_id)
            .ok_or_else(|| "\u{627e}\u{4e0d}\u{5230}\u{8d26}\u{53f7}".into())
    }

    fn slot(&self, platform: Platform, account_id: &str) -> Result<&Account, String> {
        self.slots
            .iter()
            .find(|slot| slot.platform == platform.as_str() && slot.id == account_id)
            .ok_or_else(|| "\u{627e}\u{4e0d}\u{5230}\u{8d26}\u{53f7}".into())
    }
}

struct AppState {
    io: Mutex<()>,
    page_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    background: Mutex<HashMap<String, bool>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn accounts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("accounts.json"))
}

fn load_accounts(path: &Path) -> AccountsFile {
    let mut accounts: AccountsFile = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    accounts.migrate();
    accounts
}

fn save_accounts(path: &Path, accounts: &AccountsFile) -> Result<(), String> {
    let text = serde_json::to_string_pretty(accounts).map_err(|err| err.to_string())?;
    std::fs::write(path, text).map_err(|err| err.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountDto {
    id: String,
    platform: String,
    bound: bool,
    nickname: String,
    avatar: String,
    bound_at: u64,
    last_sync_at: u64,
    last_error: String,
    message_url: String,
    window_open: bool,
}

#[derive(Serialize)]
struct StatusDto {
    accounts: Vec<AccountDto>,
}

fn account_dto(app: &AppHandle, account: &Account) -> AccountDto {
    let platform = Platform::parse(&account.platform).unwrap_or(Platform::Xhs);
    let label = window_label(platform, &account.id);
    AccountDto {
        id: account.id.clone(),
        platform: account.platform.clone(),
        bound: account.bound,
        nickname: account.nickname.clone(),
        avatar: account.avatar.clone(),
        bound_at: account.bound_at,
        last_sync_at: account.last_sync_at,
        last_error: account.last_error.clone(),
        message_url: account.message_url.clone(),
        window_open: app.get_webview_window(&label).is_some(),
    }
}

fn status_of(app: &AppHandle, accounts: &AccountsFile) -> StatusDto {
    StatusDto {
        accounts: accounts
            .slots
            .iter()
            .map(|account| account_dto(app, account))
            .collect(),
    }
}

fn read_status(app: &AppHandle, state: &AppState) -> Result<StatusDto, String> {
    let _guard = state.io.lock().unwrap_or_else(|err| err.into_inner());
    let path = accounts_path(app)?;
    Ok(status_of(app, &load_accounts(&path)))
}

fn update_accounts<T>(
    app: &AppHandle,
    state: &AppState,
    update: impl FnOnce(&mut AccountsFile) -> Result<T, String>,
) -> Result<(T, StatusDto), String> {
    let _guard = state.io.lock().unwrap_or_else(|err| err.into_inner());
    let path = accounts_path(app)?;
    let mut accounts = load_accounts(&path);
    let value = update(&mut accounts)?;
    save_accounts(&path, &accounts)?;
    Ok((value, status_of(app, &accounts)))
}

fn page_lock(app: &AppHandle, label: &str) -> Arc<tokio::sync::Mutex<()>> {
    let state = app.state::<AppState>();
    let mut locks = state
        .page_locks
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    locks
        .entry(label.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn on_main<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(task());
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|err| err.to_string())
}

fn profile_dir(app: &AppHandle, label: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("profiles")
        .join(label);
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn set_background(app: &AppHandle, label: &str, background: bool) {
    if let Some(state) = app.try_state::<AppState>() {
        let mut guard = state
            .background
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        guard.insert(label.to_string(), background);
    }
}

fn background_window(app: &AppHandle, label: &str) -> bool {
    app.try_state::<AppState>()
        .and_then(|state| {
            state
                .background
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .get(label)
                .copied()
        })
        .unwrap_or(false)
}

fn os_click(x: i32, y: i32) {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetCursorPos(point: *mut OsPoint) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn mouse_event(flags: u32, dx: u32, dy: u32, data: u32, extra: usize);
    }
    #[repr(C)]
    struct OsPoint {
        x: i32,
        y: i32,
    }
    unsafe {
        let mut old = OsPoint { x: 0, y: 0 };
        GetCursorPos(&mut old);
        SetCursorPos(x, y);
        mouse_event(0x0002, 0, 0, 0, 0);
        mouse_event(0x0004, 0, 0, 0, 0);
        SetCursorPos(old.x, old.y);
    }
}

fn screen_css_point(app: &AppHandle, label: &str, x: f64, y: f64) -> Result<(i32, i32), String> {
    let label = label.to_string();
    let app_for_task = app.clone();
    on_main(app, move || {
        let Some(window) = app_for_task.get_webview_window(&label) else {
            return Err("\u{627e}\u{4e0d}\u{5230}\u{7a97}\u{53e3}".into());
        };
        let _ = window.set_focusable(true);
        let _ = window.set_focus();
        let origin = window.inner_position().map_err(|err| err.to_string())?;
        let scale = window.scale_factor().map_err(|err| err.to_string())?;
        Ok((
            origin.x + (x * scale).round() as i32,
            origin.y + (y * scale).round() as i32,
        ))
    })?
}

async fn trusted_douyin_open(
    app: &AppHandle,
    window: &WebviewWindow,
    title: &str,
) -> Result<bool, String> {
    wake_for_layout(app, window.label())?;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let point = eval_action(
        app,
        window.clone(),
        json!({ "type": "douyin-row", "title": title }),
    )
    .await
    .unwrap_or(json!({}));
    if let Ok(body) = serde_json::to_string(&point) {
        let _ = std::fs::write(
            r"C:\Users\YCSK-039\Documents\ChatGPT\easy-msg\click-debug.json",
            body,
        );
    }
    if !bool_field(&point, "found") {
        return Ok(false);
    }
    let x = point.get("x").and_then(|item| item.as_f64()).unwrap_or(0.0);
    let y = point.get("y").and_then(|item| item.as_f64()).unwrap_or(0.0);
    let (screen_x, screen_y) = screen_css_point(app, window.label(), x, y)?;
    let _ = std::fs::write(
        r"C:\Users\YCSK-039\Documents\ChatGPT\easy-msg\click-debug.json",
        format!("{{\"css\":[{x},{y}],\"screen\":[{screen_x},{screen_y}],\"title\":{title:?}}}"),
    );
    os_click(screen_x, screen_y);
    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    Ok(true)
}

fn wake_for_layout(app: &AppHandle, label: &str) -> Result<(), String> {
    let label = label.to_string();
    let app_for_task = app.clone();
    on_main(app, move || {
        let Some(window) = app_for_task.get_webview_window(&label) else {
            return Ok(());
        };
        let main = app_for_task.get_webview_window("main");
        let (x, y) = main
            .as_ref()
            .and_then(|item| item.outer_position().ok())
            .map(|pos| (pos.x, pos.y))
            .unwrap_or((80, 80));
        let _ = window.set_focusable(false);
        let _ = window.unminimize();
        let _ = window.set_size(tauri::LogicalSize::new(1100.0, 780.0));
        let _ = window.set_position(tauri::PhysicalPosition::new(x + 28, y + 28));
        let _ = window.show();
        let _ = window.set_focusable(true);
        let _ = window.set_focus();
        Ok(())
    })?
}

fn park_window(app: &AppHandle, window: &WebviewWindow) {
    set_background(app, window.label(), true);
    let _ = window.set_focusable(false);
    let _ = window.set_skip_taskbar(true);
    // A hidden WebView reports an empty box, so Douyin never paints the inbox.
    let _ = window.set_position(tauri::LogicalPosition::new(-20000.0, -20000.0));
    let _ = window.show();
}

fn reveal_window(app: &AppHandle, window: &WebviewWindow, focus: bool) {
    set_background(app, window.label(), false);
    let _ = window.set_focusable(true);
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_position(tauri::LogicalPosition::new(120.0, 80.0));
    let _ = window.show();
    let _ = window.unminimize();
    if focus {
        let _ = window.set_focus();
    }
}

fn ensure_window(
    app: &AppHandle,
    platform: Platform,
    account_id: &str,
    entry: &str,
    reveal: bool,
    focus: bool,
    navigate_now: bool,
) -> Result<WebviewWindow, String> {
    let entry = entry.to_string();
    let label = window_label(platform, account_id);
    let app_handle = app.clone();
    on_main(app, move || {
        if let Some(window) = app_handle.get_webview_window(&label) {
            if navigate_now {
                if let Ok(url) = platform.entry_url(&entry).parse::<Url>() {
                    let _ = window.navigate(url);
                }
            }
            if reveal {
                reveal_window(&app_handle, &window, focus);
            } else {
                park_window(&app_handle, &window);
            }
            return Ok(window);
        }

        let dir = profile_dir(&app_handle, &label)?;
        let url = platform
            .entry_url(&entry)
            .parse::<Url>()
            .map_err(|err| err.to_string())?;
        let window = WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::External(url))
            .title(format!("{} \u{4f1a}\u{8bdd}", platform.title()))
            .inner_size(1080.0, 760.0)
            .min_inner_size(860.0, 620.0)
            .data_directory(dir)
            .visible(reveal)
            .focused(false)
            .skip_taskbar(!reveal)
            .build()
            .map_err(|err| err.to_string())?;
        if !reveal {
            set_background(&app_handle, window.label(), true);
            let _ = window.set_focusable(false);
        }
        Ok(window)
    })?
}

fn action_json(action: &Value) -> String {
    serde_json::to_string(action).unwrap_or_else(|_| "null".into())
}

fn script_for(action: &Value) -> String {
    format!(
        "(function(){{try{{window.__easyRev=19;window.__easyRun=(function(){{\n{}\nreturn run;}})();return JSON.stringify({{ok:true,value:window.__easyRun({})}});}}catch(error){{return JSON.stringify({{ok:false,error:String(error&&(error.stack||error.message)||error)}});}}}})()",
        BRIDGE,
        action_json(action)
    )
}

fn quick_script(action: &Value) -> String {
    format!(
        "(function(){{try{{if(typeof window.__easyRun!==\"function\"||window.__easyRev!==19)return JSON.stringify({{ok:false,error:\"missing-bridge\"}});return JSON.stringify({{ok:true,value:window.__easyRun({})}});}}catch(error){{return JSON.stringify({{ok:false,error:String(error&&(error.message)||error)}});}}}})()",
        action_json(action)
    )
}

async fn eval_raw(app: &AppHandle, window: WebviewWindow, script: String) -> Result<Value, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<String, String>>(1);
    let callback_tx = tx.clone();
    app.run_on_main_thread(move || {
        if let Err(err) = window.eval_with_callback(script, move |raw| {
            let _ = callback_tx.try_send(Ok(raw));
        }) {
            let _ = tx.try_send(Err(err.to_string()));
        }
    })
    .map_err(|err| err.to_string())?;

    let raw = tokio::time::timeout(std::time::Duration::from_secs(20), rx.recv())
        .await
        .map_err(|_| "\u{9875}\u{9762}\u{811a}\u{672c}\u{8d85}\u{65f6}".to_string())?
        .ok_or_else(|| {
            "\u{9875}\u{9762}\u{811a}\u{672c}\u{6ca1}\u{6709}\u{8fd4}\u{56de}".to_string()
        })?;
    parse_eval(&raw?)
}

async fn eval_action_once(
    app: &AppHandle,
    window: WebviewWindow,
    action: Value,
) -> Result<Value, String> {
    match eval_raw(app, window.clone(), quick_script(&action)).await {
        Ok(value) => Ok(value),
        Err(err) if err == "missing-bridge" => eval_raw(app, window, script_for(&action)).await,
        Err(err) => Err(err),
    }
}

async fn eval_action(
    app: &AppHandle,
    window: WebviewWindow,
    action: Value,
) -> Result<Value, String> {
    match eval_action_once(app, window.clone(), action.clone()).await {
        Ok(value) => Ok(value),
        Err(err) => {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            eval_action_once(app, window, action).await.map_err(|_| err)
        }
    }
}

fn parse_eval(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Err("\u{9875}\u{9762}\u{6ca1}\u{6709}\u{8fd4}\u{56de}\u{7ed3}\u{679c}".into());
    }
    let mut value: Value = serde_json::from_str(trimmed).map_err(|err| {
        format!("\u{65e0}\u{6cd5}\u{89e3}\u{6790}\u{9875}\u{9762}\u{7ed3}\u{679c}: {err}")
    })?;
    if let Some(text) = value.as_str() {
        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
            value = parsed;
        }
    }
    if value.get("ok").and_then(|item| item.as_bool()) == Some(false) {
        return Err(value
            .get("error")
            .and_then(|item| item.as_str())
            .unwrap_or("\u{9875}\u{9762}\u{811a}\u{672c}\u{5931}\u{8d25}")
            .to_string());
    }
    Ok(value.get("value").cloned().unwrap_or(Value::Null))
}

async fn wait_for_platform(window: &WebviewWindow, platform: Platform) -> String {
    for attempt in 0..40 {
        if let Ok(url) = window.url() {
            let host = url.host_str().unwrap_or("");
            if platform
                .hosts()
                .iter()
                .any(|item| host == *item || host.ends_with(&format!(".{item}")))
            {
                if attempt > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                }
                return url.to_string();
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    window.url().map(|url| url.to_string()).unwrap_or_default()
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn bool_field(value: &Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(|item| item.as_bool())
        .unwrap_or(false)
}

fn number_field(value: &Value, key: &str) -> u64 {
    value
        .get(key)
        .and_then(|item| {
            item.as_u64()
                .or_else(|| item.as_f64().map(|number| number as u64))
        })
        .unwrap_or(0)
}

fn page_value<'a>(value: &'a Value) -> &'a Value {
    value.get("page").unwrap_or(value)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Conversation {
    id: String,
    title: String,
    preview: String,
    time: String,
    unread: u64,
    avatar: String,
    platform: String,
    account_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    text: String,
    from_me: bool,
    time: String,
    image: String,
}

fn conversations_from(value: &Value, platform: Platform, account_id: &str) -> Vec<Conversation> {
    value
        .get("conversations")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let title = string_field(item, "title");
            if title.is_empty() {
                return None;
            }
            let id = string_field(item, "id");
            Some(Conversation {
                id: if id.is_empty() { title.clone() } else { id },
                title,
                preview: string_field(item, "preview"),
                time: string_field(item, "time"),
                unread: number_field(item, "unread"),
                avatar: https_only(&string_field(item, "avatar")),
                platform: platform.as_str().into(),
                account_id: account_id.to_string(),
            })
        })
        .collect()
}

fn messages_from(value: &Value) -> Vec<ChatMessage> {
    value
        .get("messages")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let text = string_field(item, "text");
            if text.is_empty() {
                return None;
            }
            let id = string_field(item, "id");
            Some(ChatMessage {
                id: if id.is_empty() {
                    text.chars().take(24).collect()
                } else {
                    id
                },
                text,
                from_me: bool_field(item, "fromMe"),
                time: string_field(item, "time"),
                image: https_only(&string_field(item, "image")),
            })
        })
        .collect()
}

fn merge_conversations(base: Vec<Conversation>, extra: Vec<Conversation>) -> Vec<Conversation> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::new();
    for item in base.into_iter().chain(extra) {
        if item.title.is_empty() || !seen.insert(item.title.clone()) {
            continue;
        }
        merged.push(item);
        if merged.len() >= 120 {
            break;
        }
    }
    merged
}

fn message_key(message: &ChatMessage) -> String {
    format!("{}|{}|{}", message.from_me, message.time, message.text)
}

fn merge_history(existing: Vec<ChatMessage>, page: Vec<ChatMessage>) -> Vec<ChatMessage> {
    if page.is_empty() {
        return existing;
    }
    if existing.is_empty() {
        return cap_messages(page);
    }
    let existing_keys: Vec<String> = existing.iter().map(message_key).collect();
    let mut overlap = None;
    for (index, message) in page.iter().enumerate() {
        let key = message_key(message);
        if existing_keys.iter().any(|item| item == &key) {
            overlap = Some(index);
            break;
        }
    }
    let mut merged = Vec::new();
    if let Some(index) = overlap {
        for message in page.into_iter().take(index) {
            let key = message_key(&message);
            if !existing_keys.iter().any(|item| item == &key) {
                merged.push(message);
            }
        }
        merged.extend(existing);
    } else {
        let mut seen: std::collections::HashSet<String> = existing_keys.into_iter().collect();
        for message in page {
            if seen.insert(message_key(&message)) {
                merged.push(message);
            }
        }
        merged.extend(existing);
    }
    cap_messages(merged)
}

fn cap_messages(mut messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    let start = messages.len().saturating_sub(120);
    if start == 0 {
        messages
    } else {
        messages.split_off(start)
    }
}

fn call_cdp(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    method: &str,
    params: &str,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CallDevToolsProtocolMethodCompletedHandler;
    let method = windows_core::HSTRING::from(method);
    let params = windows_core::HSTRING::from(params);
    unsafe {
        core.CallDevToolsProtocolMethod(
            &method,
            &params,
            None::<&ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>,
        )
        .map_err(|err| err.to_string())
    }
}

fn trusted_cdp_wheel(window: &WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .with_webview(move |webview| {
            let result = (|| -> Result<(), String> {
                let core = unsafe { webview.controller().CoreWebView2() }.map_err(|err| err.to_string())?;
                let moved = format!(r#"{{"type":"mouseMoved","x":{x},"y":{y},"modifiers":0}}"#);
                call_cdp(&core, "Input.dispatchMouseEvent", &moved)?;
                for delta in [-220, -360, -520] {
                    let params = format!(
                        r#"{{"type":"mouseWheel","x":{x},"y":{y},"deltaX":0,"deltaY":{delta},"modifiers":0,"pointerType":"mouse"}}"#
                    );
                    call_cdp(&core, "Input.dispatchMouseEvent", &params)?;
                }
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| err.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(3))
        .map_err(|err| err.to_string())?
}

#[repr(C)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn wheel_lparam(x: i32, y: i32) -> isize {
    let packed_x = x as i16 as u16 as u32;
    let packed_y = y as i16 as u16 as u32;
    ((packed_y << 16) | packed_x) as isize
}

fn largest_child(parent: isize) -> Option<isize> {
    struct Search {
        best: isize,
        area: i32,
    }
    unsafe extern "system" fn on_child(hwnd: isize, lparam: isize) -> i32 {
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetWindowRect(hwnd: isize, rect: *mut WinRect) -> i32;
        }
        let search = unsafe { &mut *(lparam as *mut Search) };
        let mut rect = WinRect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(hwnd, &mut rect) } != 0 {
            let area = (rect.right - rect.left).saturating_mul(rect.bottom - rect.top);
            if area > search.area {
                search.area = area;
                search.best = hwnd;
            }
        }
        1
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumChildWindows(
            hwnd: isize,
            cb: unsafe extern "system" fn(isize, isize) -> i32,
            lparam: isize,
        ) -> i32;
    }
    let mut search = Search { best: 0, area: 0 };
    unsafe {
        EnumChildWindows(parent, on_child, &mut search as *mut Search as isize);
    }
    if search.best == 0 {
        None
    } else {
        Some(search.best)
    }
}

fn trusted_os_wheel(
    app: &AppHandle,
    window: &WebviewWindow,
    css_x: f64,
    css_y: f64,
) -> Result<(), String> {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    }
    let label = window.label().to_string();
    let app_handle = app.clone();
    on_main(app, move || {
        let Some(window) = app_handle.get_webview_window(&label) else {
            return Err("\u{627e}\u{4e0d}\u{5230}\u{7a97}\u{53e3}".into());
        };
        let origin = window.inner_position().map_err(|err| err.to_string())?;
        let scale = window.scale_factor().map_err(|err| err.to_string())?;
        let hwnd = window.hwnd().map_err(|err| err.to_string())?;
        let screen_x = origin.x + (css_x * scale).round() as i32;
        let screen_y = origin.y + (css_y * scale).round() as i32;
        if !(-32000..=32000).contains(&screen_x) || !(-32000..=32000).contains(&screen_y) {
            return Err("wheel-point".into());
        }
        let target = largest_child(hwnd.0 as isize).unwrap_or(hwnd.0 as isize);
        unsafe {
            for _ in 0..4 {
                SendMessageW(
                    target,
                    0x020A,
                    (120u32 << 16) as usize,
                    wheel_lparam(screen_x, screen_y),
                );
            }
        }
        Ok(())
    })?
}

fn history_wheel(app: &AppHandle, window: &WebviewWindow, x: f64, y: f64) -> String {
    if x < 8.0 || y < 8.0 {
        return "skip".into();
    }
    let cdp = match trusted_cdp_wheel(window, x, y) {
        Ok(()) => "cdp".to_string(),
        Err(err) => format!("cdp-err:{err}"),
    };
    let os = match trusted_os_wheel(app, window, x, y) {
        Ok(()) => "os".to_string(),
        Err(err) => format!("os-err:{err}"),
    };
    format!("{cdp}+{os}")
}

async fn collect_older_messages(
    app: &AppHandle,
    window: &WebviewWindow,
    mut messages: Vec<ChatMessage>,
) -> Vec<ChatMessage> {
    let mut stalled = 0;
    for _ in 0..6 {
        let step = eval_action(
            app,
            window.clone(),
            json!({ "type": "scroll-messages", "direction": "up" }),
        )
        .await
        .unwrap_or(json!({}));
        if !bool_field(&step, "found") {
            break;
        }
        let mut wheel = "skip".to_string();
        let mut called = String::new();
        if !bool_field(&step, "moved") || bool_field(&step, "atTop") {
            let nudge = eval_action(app, window.clone(), json!({ "type": "history-nudge" }))
                .await
                .unwrap_or(json!({}));
            called = nudge
                .get("called")
                .and_then(|item| item.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            let x = step.get("x").and_then(|item| item.as_f64()).unwrap_or(0.0);
            let y = step.get("y").and_then(|item| item.as_f64()).unwrap_or(0.0);
            wheel = history_wheel(app, window, x, y);
        }
        tokio::time::sleep(std::time::Duration::from_millis(if wheel == "skip" {
            420
        } else {
            860
        }))
        .await;
        let page = eval_action(app, window.clone(), json!({ "type": "messages" }))
            .await
            .unwrap_or(json!({}));
        let before = messages.len();
        messages = merge_history(messages, messages_from(&page));
        #[cfg(debug_assertions)]
        eprintln!(
            "history moved={} top={} height={} client={} count={} overflow={} flex={} reversed={} wheel={} nudge={} class={}",
            bool_field(&step, "moved"),
            step.get("top").and_then(|item| item.as_i64()).unwrap_or(-1),
            step.get("height")
                .and_then(|item| item.as_i64())
                .unwrap_or(-1),
            step.get("client")
                .and_then(|item| item.as_i64())
                .unwrap_or(-1),
            messages.len(),
            step.get("overflow")
                .and_then(|item| item.as_str())
                .unwrap_or(""),
            step.get("flex")
                .and_then(|item| item.as_str())
                .unwrap_or(""),
            bool_field(&step, "reversed"),
            wheel,
            called,
            step.get("className")
                .and_then(|item| item.as_str())
                .unwrap_or("")
        );
        if messages.len() > before {
            stalled = 0;
            if messages.len() >= 120 {
                break;
            }
            continue;
        }
        stalled += 1;
        if stalled >= 2 {
            break;
        }
    }
    let _ = eval_action(
        app,
        window.clone(),
        json!({ "type": "scroll-messages", "direction": "end" }),
    )
    .await;
    messages
}

async fn collect_douyin_conversations(
    app: &AppHandle,
    window: &WebviewWindow,
    account_id: &str,
    seed: Vec<Conversation>,
) -> Vec<Conversation> {
    let _ = eval_action(
        app,
        window.clone(),
        json!({ "type": "scroll-list", "direction": "top" }),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(220)).await;
    let first = eval_action(app, window.clone(), json!({ "type": "conversations" }))
        .await
        .unwrap_or(json!({}));
    let mut merged = merge_conversations(
        seed,
        conversations_from(&first, Platform::Douyin, account_id),
    );
    for _ in 0..6 {
        let step = eval_action(
            app,
            window.clone(),
            json!({ "type": "scroll-list", "direction": "down" }),
        )
        .await
        .unwrap_or(json!({}));
        let moved = bool_field(&step, "moved");
        if !moved {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(260)).await;
        let page = eval_action(app, window.clone(), json!({ "type": "conversations" }))
            .await
            .unwrap_or(json!({}));
        let before = merged.len();
        merged = merge_conversations(
            merged,
            conversations_from(&page, Platform::Douyin, account_id),
        );
        if bool_field(&step, "atEnd") || merged.len() == before {
            break;
        }
    }
    let _ = eval_action(
        app,
        window.clone(),
        json!({ "type": "scroll-list", "direction": "top" }),
    )
    .await;
    merged
}

fn https_only(value: &str) -> String {
    if value.starts_with("https://") {
        value.to_string()
    } else {
        String::new()
    }
}

fn apply_page(account: &mut Account, page: &Value) {
    if bool_field(page, "loggedIn") {
        account.bound = true;
        if account.bound_at == 0 {
            account.bound_at = now_ms();
        }
        let nickname = string_field(page, "nickname");
        let avatar = https_only(&string_field(page, "avatar"));
        if !nickname.is_empty() && !placeholder_name(&nickname) {
            account.nickname = nickname;
        } else if placeholder_name(&account.nickname) {
            account.nickname.clear();
        }
        if !avatar.is_empty() {
            account.avatar = avatar;
        }
        account.last_error.clear();
    } else if bool_field(page, "loginRequired") {
        account.last_error = "\u{9700}\u{8981}\u{91cd}\u{65b0}\u{626b}\u{7801}".into();
    }
}

async fn sync_once(
    app: &AppHandle,
    window: &WebviewWindow,
    passive: bool,
) -> Result<Value, String> {
    eval_action(
        app,
        window.clone(),
        json!({ "type": "sync", "passive": passive }),
    )
    .await
}

fn placeholder_name(value: &str) -> bool {
    matches!(
        value,
        "\u{6211}\u{7684}"
            | "\u{9996}\u{9875}"
            | "\u{63a8}\u{8350}"
            | "\u{670b}\u{53cb}"
            | "\u{5173}\u{6ce8}"
            | "\u{7cbe}\u{9009}"
            | "\u{76f4}\u{64ad}"
            | "\u{6d88}\u{606f}"
            | "\u{79c1}\u{4fe1}"
            | "\u{53d1}\u{73b0}"
            | "\u{653e}\u{6620}\u{5385}"
    )
}

async fn read_inbox(app: &AppHandle, window: &WebviewWindow) -> Result<Value, String> {
    let mut report = sync_once(app, window, false).await?;
    if bool_field(&report, "nudged") {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        report = sync_once(app, window, true).await?;
    }
    Ok(report)
}

fn douyin_left_inbox(platform: Platform, url: &str) -> bool {
    if !matches!(platform, Platform::Douyin) {
        return false;
    }
    let trimmed = url.trim_end_matches('/');
    trimmed.ends_with("douyin.com") || url.contains("/jingxuan")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncDto {
    accounts: StatusDto,
    conversations: Vec<Conversation>,
    url: String,
    logged_in: bool,
    warning: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadDto {
    accounts: StatusDto,
    messages: Vec<ChatMessage>,
    warning: String,
    text_sent: bool,
    image_sent: bool,
}

#[tauri::command]
fn add_account(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
) -> Result<StatusDto, String> {
    let platform = Platform::parse(&platform)?;
    let (_, status) = update_accounts(&app, &state, |accounts| {
        let id = format!("a{}", now_ms() % 1_000_000);
        if accounts
            .slots
            .iter()
            .any(|slot| slot.platform == platform.as_str() && slot.id == id)
        {
            return Err("\u{8bf7}\u{518d}\u{8bd5}\u{4e00}\u{6b21}".into());
        }
        let mut account = Account::default();
        account.id = id;
        account.platform = platform.as_str().into();
        accounts.slots.push(account);
        Ok(())
    })?;
    Ok(status)
}

#[tauri::command]
fn remove_account(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
    account_id: String,
) -> Result<StatusDto, String> {
    let platform = Platform::parse(&platform)?;
    let label = window_label(platform, &account_id);
    let (_, status) = update_accounts(&app, &state, |accounts| {
        let before = accounts.slots.len();
        accounts
            .slots
            .retain(|slot| !(slot.platform == platform.as_str() && slot.id == account_id));
        if accounts.slots.len() == before {
            return Err("\u{627e}\u{4e0d}\u{5230}\u{8d26}\u{53f7}".into());
        }
        Ok(())
    })?;
    let app_for_close = app.clone();
    let _ = on_main(&app, move || {
        if let Some(window) = app_for_close.get_webview_window(&label) {
            let _ = window.destroy();
        }
    });
    Ok(status)
}

#[tauri::command]
fn session_status(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<StatusDto, String> {
    read_status(&app, &state)
}

#[tauri::command]
async fn open_platform(
    app: AppHandle,
    platform: String,
    account_id: Option<String>,
    entry: Option<String>,
    focus: Option<bool>,
) -> Result<StatusDto, String> {
    let platform = Platform::parse(&platform)?;
    let account_id = account_id.unwrap_or_else(|| "main".into());
    let label = window_label(platform, &account_id);
    let entry = entry.unwrap_or_else(|| "home".into());
    let focus = focus.unwrap_or(true);
    let window = ensure_window(&app, platform, &account_id, &entry, true, focus, true)?;
    let lock = page_lock(&app, &label);
    let app_for_page = app.clone();
    tauri::async_runtime::spawn(async move {
        let _guard = lock.lock().await;
        wait_for_platform(&window, platform).await;
        if entry == "home" {
            let _ = eval_action(&app_for_page, window, json!({ "type": "nudge-login" })).await;
        }
    });
    let state = app.state::<AppState>();
    read_status(&app, &state)
}

#[tauri::command]
async fn confirm_login(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
    account_id: Option<String>,
    force: Option<bool>,
) -> Result<StatusDto, String> {
    let platform = Platform::parse(&platform)?;
    let account_id = account_id.unwrap_or_else(|| "main".into());
    let label = window_label(platform, &account_id);
    let force = force.unwrap_or(false);
    let lock = page_lock(&app, &label);
    let _guard = lock.lock().await;
    let window = ensure_window(&app, platform, &account_id, "home", true, true, false)?;
    wait_for_platform(&window, platform).await;
    let mut page = eval_action(&app, window.clone(), json!({ "type": "detect" })).await?;
    let mut logged_in = bool_field(&page, "loggedIn");
    if !logged_in && !force {
        let reloaded = window.clone();
        let _ = on_main(&app, move || {
            reloaded
                .eval("location.reload()")
                .map_err(|err| err.to_string())
        })?;
        tokio::time::sleep(std::time::Duration::from_millis(1600)).await;
        page = eval_action(&app, window.clone(), json!({ "type": "detect" })).await?;
        logged_in = bool_field(&page, "loggedIn");
    }
    if !logged_in && !force {
        let url = string_field(&page, "url");
        return Err(format!(
            "\u{6ca1}\u{6709}\u{8bc6}\u{522b}\u{5230}\u{5df2}\u{767b}\u{5f55}\u{8d26}\u{53f7}: {url}"
        ));
    }
    let (_, status) = update_accounts(&app, &state, |accounts| {
        let account = accounts.slot_mut(platform, &account_id)?;
        if logged_in {
            apply_page(account, &page);
        } else {
            account.bound = true;
            if account.bound_at == 0 {
                account.bound_at = now_ms();
            }
            account.last_error =
                "\u{5df2}\u{6309}\u{624b}\u{52a8}\u{786e}\u{8ba4}\u{7ed1}\u{5b9a}".into();
        }
        Ok(())
    })?;
    if logged_in || force {
        let parked = window;
        let app_for_hide = app.clone();
        on_main(&app, move || {
            park_window(&app_for_hide, &parked);
        })?;
    }
    Ok(status)
}

#[tauri::command]
async fn probe_login(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
    account_id: Option<String>,
) -> Result<StatusDto, String> {
    let platform = Platform::parse(&platform)?;
    let account_id = account_id.unwrap_or_else(|| "main".into());
    let label = window_label(platform, &account_id);
    let existing = on_main(&app, {
        let app = app.clone();
        let label = label.clone();
        move || app.get_webview_window(&label)
    })?;
    let window = if let Some(window) = existing {
        window
    } else {
        ensure_window(&app, platform, &account_id, "home", false, false, false)?
    };
    wait_for_platform(&window, platform).await;
    let lock = page_lock(&app, &label);
    let _guard = lock.lock().await;
    let mut page = match eval_action(&app, window.clone(), json!({ "type": "detect" })).await {
        Ok(page) => page,
        Err(_) => return read_status(&app, &state),
    };
    if !bool_field(&page, "loggedIn") {
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        page = match eval_action(&app, window.clone(), json!({ "type": "detect" })).await {
            Ok(page) => page,
            Err(_) => return read_status(&app, &state),
        };
    }
    if !bool_field(&page, "loggedIn") {
        return read_status(&app, &state);
    }
    let (_, status) = update_accounts(&app, &state, |accounts| {
        apply_page(accounts.slot_mut(platform, &account_id)?, &page);
        Ok(())
    })?;
    let app_for_hide = app.clone();
    on_main(&app, move || {
        park_window(&app_for_hide, &window);
    })?;
    Ok(status)
}

#[tauri::command]
async fn sync_platform(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
    account_id: Option<String>,
    interactive: Option<bool>,
) -> Result<SyncDto, String> {
    let platform = Platform::parse(&platform)?;
    let account_id = account_id.unwrap_or_else(|| "main".into());
    let label = window_label(platform, &account_id);
    let interactive = interactive.unwrap_or(true);
    let lock = page_lock(&app, &label);
    let _guard = lock.lock().await;
    let saved_url = {
        let _io = state.io.lock().unwrap_or_else(|err| err.into_inner());
        let path = accounts_path(&app)?;
        load_accounts(&path)
            .slot(platform, &account_id)?
            .message_url
            .clone()
    };
    let window = ensure_window(&app, platform, &account_id, "messages", false, false, false)?;
    wait_for_platform(&window, platform).await;
    let mut report = read_inbox(&app, &window).await?;
    let mut conversations = conversations_from(&report, platform, &account_id);
    let mut page = page_value(&report).clone();
    let mut url = string_field(&page, "url");
    if conversations.is_empty() {
        if !platform.is_message_url(&url) {
            let target = if saved_url.is_empty() || !platform.is_message_url(&saved_url) {
                platform.entry_url("messages").to_string()
            } else {
                saved_url
            };
            if let Ok(target_url) = target.parse::<Url>() {
                let window_for_nav = window.clone();
                on_main(&app, move || {
                    window_for_nav
                        .navigate(target_url)
                        .map_err(|err| err.to_string())
                })??;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
        report = read_inbox(&app, &window).await?;
        conversations = conversations_from(&report, platform, &account_id);
        page = page_value(&report).clone();
        url = string_field(&page, "url");
        if conversations.is_empty() && douyin_left_inbox(platform, &url) {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            report = read_inbox(&app, &window).await?;
            conversations = conversations_from(&report, platform, &account_id);
            page = page_value(&report).clone();
            url = string_field(&page, "url");
        }
        if conversations.is_empty() && url.contains("/chat") {
            tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
            report = read_inbox(&app, &window).await?;
            conversations = conversations_from(&report, platform, &account_id);
            page = page_value(&report).clone();
            url = string_field(&page, "url");
        }
    }
    let warning = if conversations.is_empty() {
        if bool_field(&page, "loginRequired") {
            "\u{9700}\u{8981}\u{91cd}\u{65b0}\u{626b}\u{7801}".to_string()
        } else if interactive {
            "\u{6ca1}\u{6709}\u{8bfb}\u{5230}\u{4f1a}\u{8bdd}".to_string()
        } else {
            "\u{540e}\u{53f0}\u{9875}\u{9762}\u{6ca1}\u{6709}\u{8bfb}\u{5230}\u{4f1a}\u{8bdd}"
                .to_string()
        }
    } else {
        String::new()
    };
    if let Ok(fresh) = eval_action(&app, window.clone(), json!({ "type": "detect" })).await {
        if !string_field(&fresh, "url").is_empty() {
            page = fresh;
        }
    }
    let logged_in = bool_field(&page, "loggedIn");
    let (conversations, accounts) = update_accounts(&app, &state, |accounts| {
        let account = accounts.slot_mut(platform, &account_id)?;
        apply_page(account, &page);
        account.last_sync_at = now_ms();
        if !warning.is_empty() {
            account.last_error = warning.clone();
        } else {
            account.last_error.clear();
            account.message_url = url.clone();
        }
        Ok(conversations)
    })?;
    let conversations = if matches!(platform, Platform::Douyin) && !conversations.is_empty() {
        collect_douyin_conversations(&app, &window, &account_id, conversations).await
    } else {
        conversations
    };
    #[cfg(debug_assertions)]
    eprintln!(
        "sync {} count={} url={}",
        platform.as_str(),
        conversations.len(),
        url
    );
    Ok(SyncDto {
        accounts,
        conversations,
        url,
        logged_in,
        warning,
    })
}

#[tauri::command]
async fn load_thread(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
    account_id: Option<String>,
    id: String,
    title: String,
) -> Result<ThreadDto, String> {
    let platform = Platform::parse(&platform)?;
    let account_id = account_id.unwrap_or_else(|| "main".into());
    let label = window_label(platform, &account_id);
    let lock = page_lock(&app, &label);
    let _guard = lock.lock().await;
    let window = ensure_window(&app, platform, &account_id, "messages", false, false, false)?;
    wait_for_platform(&window, platform).await;
    let opened = eval_action(
        &app,
        window.clone(),
        json!({ "type": "open", "id": id, "title": title }),
    )
    .await?;
    if !matches!(platform, Platform::Douyin) {
        let _ = eval_action(&app, window.clone(), json!({ "type": "scroll-end" })).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;
    let mut report = eval_action(&app, window.clone(), json!({ "type": "messages" })).await?;
    let mut messages = messages_from(&report);
    if messages.is_empty() {
        tokio::time::sleep(std::time::Duration::from_millis(320)).await;
        report = eval_action(&app, window.clone(), json!({ "type": "messages" })).await?;
        messages = messages_from(&report);
    }
    if matches!(platform, Platform::Douyin) && !messages.is_empty() {
        messages = collect_older_messages(&app, &window, messages).await;
    }
    let warning = if bool_field(&opened, "opened") || !messages.is_empty() {
        String::new()
    } else {
        "\u{8fd8}\u{6ca1}\u{8bfb}\u{5230}\u{8fd9}\u{6761}\u{4f1a}\u{8bdd}".into()
    };
    Ok(ThreadDto {
        accounts: read_status(&app, &state)?,
        messages,
        warning,
        text_sent: false,
        image_sent: false,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingImage {
    name: String,
    mime: String,
    data: String,
}

fn outgoing_image(image: &OutgoingImage) -> Result<(), String> {
    if !matches!(
        image.mime.as_str(),
        "image/jpeg" | "image/png" | "image/gif" | "image/webp"
    ) {
        return Err("\u{53ea}\u{80fd}\u{53d1}\u{9001}\u{56fe}\u{7247}".into());
    }
    let mut len = image.data.len();
    if image.data.ends_with("==") {
        len = len.saturating_sub(2);
    } else if image.data.ends_with('=') {
        len = len.saturating_sub(1);
    }
    if image.data.len() < 16 || len / 4 * 3 > 8 * 1024 * 1024 {
        return Err("\u{56fe}\u{7247}\u{4e0d}\u{80fd}\u{8d85}\u{8fc7} 8MB".into());
    }
    Ok(())
}

async fn capture_editor_probe(app: &AppHandle, window: &WebviewWindow) -> Value {
    let probe = eval_action(app, window.clone(), json!({ "type": "editor-probe" }))
        .await
        .unwrap_or(json!({ "error": "probe-failed" }));
    if let Ok(body) = serde_json::to_string_pretty(&probe) {
        let _ = std::fs::write(
            r"C:\Users\YCSK-039\Documents\ChatGPT\easy-msg\editor-probe.json",
            &body,
        );
    }
    probe
}

#[tauri::command]
async fn send_message(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    platform: String,
    account_id: Option<String>,
    id: String,
    title: String,
    text: String,
    image: Option<OutgoingImage>,
) -> Result<ThreadDto, String> {
    let platform = Platform::parse(&platform)?;
    let account_id = account_id.unwrap_or_else(|| "main".into());
    let label = window_label(platform, &account_id);
    let text = text.trim().to_string();
    let image = image.filter(|item| !item.data.is_empty());
    if text.is_empty() && image.is_none() {
        return Err("\u{6d88}\u{606f}\u{4e0d}\u{80fd}\u{4e3a}\u{7a7a}".into());
    }
    if text.chars().count() > 2000 {
        return Err("\u{6d88}\u{606f}\u{592a}\u{957f}".into());
    }
    if let Some(image) = &image {
        outgoing_image(image)?;
    }
    let lock = page_lock(&app, &label);
    let _guard = lock.lock().await;
    let window = ensure_window(&app, platform, &account_id, "messages", false, false, false)?;
    wait_for_platform(&window, platform).await;
    let opened = eval_action(
        &app,
        window.clone(),
        json!({ "type": "open", "id": id, "title": title }),
    )
    .await?;
    if !bool_field(&opened, "opened") {
        return Err("\u{8fd8}\u{6ca1}\u{8bfb}\u{5230}\u{8fd9}\u{6761}\u{4f1a}\u{8bdd}".into());
    }
    let mut editor_ready = false;
    for _ in 0..4 {
        let ready = eval_action(&app, window.clone(), json!({ "type": "editor-ready" }))
            .await
            .unwrap_or(json!({}));
        if bool_field(&ready, "found") {
            editor_ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    if !editor_ready && matches!(platform, Platform::Douyin) {
        let _ = trusted_douyin_open(&app, &window, &title).await;
    } else if !editor_ready {
        wake_for_layout(&app, platform.as_str())?;
        let _ = eval_action(
            &app,
            window.clone(),
            json!({ "type": "open", "id": id, "title": title }),
        )
        .await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if image.is_some() {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    if image.is_some() && matches!(platform, Platform::Xhs) {
        for _ in 0..8 {
            let ready = eval_action(&app, window.clone(), json!({ "type": "xhs-probe" }))
                .await
                .unwrap_or(json!({}));
            let editor = ready
                .get("editor")
                .and_then(|item| item.as_u64())
                .unwrap_or(0);
            let handlers = ready
                .get("handlers")
                .and_then(|item| item.as_u64())
                .unwrap_or(0);
            if editor > 0 && handlers > 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        }
    }
    let mut text_sent = false;
    let mut image_sent = false;
    let mut warning = String::new();
    if !text.is_empty() {
        let mut filled = eval_action(
            &app,
            window.clone(),
            json!({ "type": "insert", "text": text }),
        )
        .await?;
        if !bool_field(&filled, "filled") {
            tokio::time::sleep(std::time::Duration::from_millis(320)).await;
            filled = eval_action(
                &app,
                window.clone(),
                json!({ "type": "editor-filled", "text": text }),
            )
            .await?;
        }
        if !bool_field(&filled, "filled") {
            let _ = eval_action(
                &app,
                window.clone(),
                json!({ "type": "insert-command", "text": text }),
            )
            .await?;
            filled = eval_action(
                &app,
                window.clone(),
                json!({ "type": "editor-filled", "text": text }),
            )
            .await?;
        }
        if !bool_field(&filled, "filled") {
            let probe = capture_editor_probe(&app, &window).await;
            let width = probe
                .get("innerWidth")
                .and_then(|item| item.as_u64())
                .unwrap_or(0);
            let height = probe
                .get("innerHeight")
                .and_then(|item| item.as_u64())
                .unwrap_or(0);
            let count = probe
                .get("interesting")
                .and_then(|item| item.as_array())
                .map(|item| item.len())
                .unwrap_or(0);
            return Err(format!(
                "\u{627e}\u{4e0d}\u{5230}\u{8f93}\u{5165}\u{6846} {width}x{height} {count}"
            ));
        }
        let sent = eval_action(&app, window.clone(), json!({ "type": "click-send" })).await?;
        text_sent = bool_field(&sent, "clicked") || bool_field(&sent, "usedEnter");
        if !text_sent {
            warning = "\u{6ca1}\u{6709}\u{70b9}\u{5230}\u{53d1}\u{9001}".into();
        } else if image.is_none() {
            tokio::time::sleep(std::time::Duration::from_millis(160)).await;
        } else {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
    }
    if warning.is_empty() {
        if let Some(image) = image {
            let name = image.name.replace(['\\', '/'], "");
            let attached = eval_action(
                &app,
                window.clone(),
                json!({
                    "type": "insert-image",
                    "name": if name.is_empty() { "image.png".to_string() } else { name.clone() },
                    "mime": image.mime.clone(),
                    "data": image.data.clone(),
                }),
            )
            .await?;
            if bool_field(&attached, "direct") {
                image_sent = true;
                tokio::time::sleep(std::time::Duration::from_millis(1600)).await;
            } else if !bool_field(&attached, "attached") {
                warning = "\u{6ca1}\u{6709}\u{8d34}\u{4e0a}\u{56fe}\u{7247}".into();
            } else {
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                let mut staged =
                    eval_action(&app, window.clone(), json!({ "type": "image-staged" })).await?;
                if !bool_field(&staged, "staged") {
                    let _ = eval_action(
                        &app,
                        window.clone(),
                        json!({
                            "type": "insert-image",
                            "buttonOnly": true,
                            "name": if name.is_empty() { "image.png".to_string() } else { name.clone() },
                            "mime": image.mime.clone(),
                            "data": image.data.clone(),
                        }),
                    )
                    .await?;
                    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                    staged = eval_action(&app, window.clone(), json!({ "type": "image-staged" }))
                        .await?;
                }
                if !bool_field(&staged, "staged") {
                    warning = "\u{6ca1}\u{6709}\u{8d34}\u{4e0a}\u{56fe}\u{7247}".into();
                } else {
                    let sent =
                        eval_action(&app, window.clone(), json!({ "type": "confirm-image" }))
                            .await?;
                    image_sent = bool_field(&sent, "clicked") || bool_field(&sent, "usedEnter");
                    if !image_sent {
                        warning = "\u{56fe}\u{7247}\u{5df2}\u{653e}\u{8fdb}\u{8f93}\u{5165}\u{6846}\u{ff0c}\u{4f46}\u{6ca1}\u{6709}\u{70b9}\u{5230}\u{53d1}\u{9001}".into();
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                }
            }
        }
    }
    let report = eval_action(&app, window.clone(), json!({ "type": "messages" })).await?;
    let hidden = window;
    let app_for_hide = app.clone();
    on_main(&app, move || {
        park_window(&app_for_hide, &hidden);
    })?;
    Ok(ThreadDto {
        accounts: read_status(&app, &state)?,
        messages: messages_from(&report),
        warning,
        text_sent,
        image_sent,
    })
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            io: Mutex::new(()),
            page_locks: Mutex::new(HashMap::new()),
            background: Mutex::new(HashMap::new()),
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            } else if matches!(window.label(), "xhs" | "douyin") {
                if let WindowEvent::Focused(true) = event {
                    let app = window.app_handle();
                    if background_window(&app, window.label()) {
                        let _ = window.set_focusable(false);
                        let _ =
                            window.set_position(tauri::LogicalPosition::new(-20000.0, -20000.0));
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            session_status,
            add_account,
            remove_account,
            open_platform,
            confirm_login,
            probe_login,
            sync_platform,
            load_thread,
            send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running easy-msg");
}
