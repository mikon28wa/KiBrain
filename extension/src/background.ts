import { runBackup } from './lib/backup';
import { transmitChat } from './lib/transmitter';
import { loadConfig, loadErrors, saveErrors } from './config';
import type { BrainChatV1, Conversation } from './lib/types';

declare const chrome: any;

const ALARM_NAME = 'kibrain-daily-backup';
export const MESSAGE_BACKUP_NOW = 'KIBRAIN_BACKUP_NOW';
const MESSAGE_DETECT_RESULT = 'KIBRAIN_DETECT_RESULT';

/**
 * Inject the detection script into the active tab on demand (no declared
 * content script). The injected script reports conversations back via
 * `chrome.runtime.sendMessage`.
 */
function detectFromActiveTab(): Promise<Conversation[]> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (conversations: Conversation[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onResult);
      resolve(conversations);
    };

    const onResult = (message: any): void => {
      if (message?.type === MESSAGE_DETECT_RESULT) {
        finish(Array.isArray(message.conversations) ? (message.conversations as Conversation[]) : []);
      }
    };

    const timeout = setTimeout(() => finish([]), 3000);
    chrome.runtime.onMessage.addListener(onResult);

    void (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs.find((t: { id?: number }) => t?.id != null);
        if (!tab) return finish([]);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch {
        finish([]);
      }
    })();
  });
}

async function run(): Promise<void> {
  await runBackup({
    loadConfig,
    detect: detectFromActiveTab,
    transmit: async (chat: BrainChatV1) => {
      const config = await loadConfig();
      await transmitChat(config.endpoint, config.token, chat);
    },
    loadErrors,
    saveErrors,
    now: () => Date.now(),
  });
}

chrome.runtime.onInstalled.addListener(() => {
  // Daily automatic run (24h). Recreated on every install/update.
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
});

chrome.alarms.onAlarm.addListener((alarm: { name: string }) => {
  if (alarm.name === ALARM_NAME) {
    void run().catch((error) => console.error('[KiBrain] daily backup failed:', error));
  }
});

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (r: unknown) => void) => {
  if (message?.type === MESSAGE_BACKUP_NOW) {
    run()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});
