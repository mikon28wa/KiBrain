/** Shared types for the extension's core logic (kept free of Chrome APIs). */

export interface Config {
  /** Base URL of the KiBrain API, e.g. https://api.example.com */
  endpoint: string;
  /** API token with the `save` scope. Stored only in the local browser profile. */
  token: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/** A conversation detected on a visited platform page. */
export interface Conversation {
  id: string;
  title?: string;
  messages: ChatMessage[];
}

/** A chat in the brain.chat.v1 import format (sourceProvider: brain.chat.v1). */
export interface BrainChatV1 {
  sourceProvider: 'brain.chat.v1';
  sourceChatId: string;
  title: string;
  messages: ChatMessage[];
  tags: string[];
}

/** Locally persisted entry for a transmission that failed and must be retried. */
export interface ErrorLogEntry {
  chat: BrainChatV1;
  attempts: number;
  lastErrorAt: number;
  lastMessage: string;
}

/** Dependencies injected into {@link runBackup} so it is unit-testable. */
export interface BackupDeps {
  loadConfig(): Promise<Config>;
  /** Detect conversations on the current platform page. */
  detect(): Promise<Conversation[]>;
  /** Transmit one chat (endpoint + token are already bound). */
  transmit(chat: BrainChatV1): Promise<void>;
  loadErrors(): Promise<ErrorLogEntry[]>;
  saveErrors(errors: ErrorLogEntry[]): Promise<void>;
  now(): number;
}
