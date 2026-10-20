// extension/src/lib/converter.ts
var MAX_TITLE_LENGTH = 255;
var FALLBACK_TITLE = "Chat";
function toBrainChatV1(conversation) {
  const firstMessage = conversation.messages[0]?.content;
  const title = conversation.title?.trim() || (firstMessage ? firstMessage.slice(0, MAX_TITLE_LENGTH) : FALLBACK_TITLE);
  return {
    sourceProvider: "brain.chat.v1",
    sourceChatId: conversation.id,
    title,
    messages: conversation.messages,
    tags: []
  };
}

// extension/src/lib/backup.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
async function runBackup(deps) {
  const config = await deps.loadConfig();
  if (!config.endpoint || !config.token) {
    throw new Error("KiBrain is not configured: endpoint and token are required.");
  }
  const errors = new Map(
    (await deps.loadErrors()).map((entry) => [entry.chat.sourceChatId, entry])
  );
  let retried = 0;
  let failed = 0;
  for (const entry of [...errors.values()]) {
    try {
      await deps.transmit(entry.chat);
      errors.delete(entry.chat.sourceChatId);
      retried += 1;
    } catch (error) {
      errors.set(entry.chat.sourceChatId, {
        ...entry,
        attempts: entry.attempts + 1,
        lastErrorAt: deps.now(),
        lastMessage: messageOf(error)
      });
      failed += 1;
    }
  }
  const conversations = await deps.detect();
  for (const conversation of conversations) {
    const chat = toBrainChatV1(conversation);
    try {
      await deps.transmit(chat);
      errors.delete(chat.sourceChatId);
    } catch (error) {
      const existing = errors.get(chat.sourceChatId);
      errors.set(chat.sourceChatId, {
        chat,
        attempts: (existing?.attempts ?? 0) + 1,
        lastErrorAt: deps.now(),
        lastMessage: messageOf(error)
      });
      failed += 1;
    }
  }
  await deps.saveErrors([...errors.values()]);
  return { detected: conversations.length, retried, failed };
}

// extension/src/lib/transmitter.ts
async function transmitChat(endpoint, token, chat, fetchImpl = fetch) {
  const base = endpoint.replace(/\/+$/, "");
  const response = await fetchImpl(`${base}/api/v1/chats`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(chat)
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
  return await response.json();
}

// extension/src/config.ts
var CONFIG_KEY = "config";
var ERROR_LOG_KEY = "errorLog";
async function loadConfig() {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  const raw = data?.[CONFIG_KEY] ?? {};
  return { endpoint: String(raw.endpoint ?? ""), token: String(raw.token ?? "") };
}
async function loadErrors() {
  const data = await chrome.storage.local.get(ERROR_LOG_KEY);
  const raw = data?.[ERROR_LOG_KEY];
  return Array.isArray(raw) ? raw : [];
}
async function saveErrors(errors) {
  await chrome.storage.local.set({ [ERROR_LOG_KEY]: errors });
}

// extension/src/background.ts
var ALARM_NAME = "kibrain-daily-backup";
var MESSAGE_BACKUP_NOW = "KIBRAIN_BACKUP_NOW";
var MESSAGE_DETECT_RESULT = "KIBRAIN_DETECT_RESULT";
function detectFromActiveTab() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (conversations) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onResult);
      resolve(conversations);
    };
    const onResult = (message) => {
      if (message?.type === MESSAGE_DETECT_RESULT) {
        finish(Array.isArray(message.conversations) ? message.conversations : []);
      }
    };
    const timeout = setTimeout(() => finish([]), 3e3);
    chrome.runtime.onMessage.addListener(onResult);
    void (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs.find((t) => t?.id != null);
        if (!tab) return finish([]);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch {
        finish([]);
      }
    })();
  });
}
async function run() {
  await runBackup({
    loadConfig,
    detect: detectFromActiveTab,
    transmit: async (chat) => {
      const config = await loadConfig();
      await transmitChat(config.endpoint, config.token, chat);
    },
    loadErrors,
    saveErrors,
    now: () => Date.now()
  });
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void run().catch((error) => console.error("[KiBrain] daily backup failed:", error));
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_BACKUP_NOW) {
    run().then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});
export {
  MESSAGE_BACKUP_NOW
};
