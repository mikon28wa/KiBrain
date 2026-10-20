import type { Config, ErrorLogEntry } from './types';

// Chrome APIs are only available in the extension runtime; the core logic never
// depends on them.
declare const chrome: any;

const CONFIG_KEY = 'config';
const ERROR_LOG_KEY = 'errorLog';

/** Load the endpoint + token from local profile storage (never synced). */
export async function loadConfig(): Promise<Config> {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  const raw = data?.[CONFIG_KEY] ?? {};
  return { endpoint: String(raw.endpoint ?? ''), token: String(raw.token ?? '') };
}

/** Persist the endpoint + token in local profile storage only. */
export async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

/** Load the locally persisted error log (failed transmissions). */
export async function loadErrors(): Promise<ErrorLogEntry[]> {
  const data = await chrome.storage.local.get(ERROR_LOG_KEY);
  const raw = data?.[ERROR_LOG_KEY];
  return Array.isArray(raw) ? (raw as ErrorLogEntry[]) : [];
}

/** Persist the error log locally. */
export async function saveErrors(errors: ErrorLogEntry[]): Promise<void> {
  await chrome.storage.local.set({ [ERROR_LOG_KEY]: errors });
}
