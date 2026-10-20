import { toBrainChatV1 } from './converter';
import type { BackupDeps, ErrorLogEntry } from './types';

export interface BackupResult {
  detected: number;
  retried: number;
  failed: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one backup pass: retry previously failed chats, then detect, convert and
 * transmit fresh conversations. Failures are persisted locally and retried on
 * the next run — no error is raised to the caller.
 */
export async function runBackup(deps: BackupDeps): Promise<BackupResult> {
  const config = await deps.loadConfig();
  if (!config.endpoint || !config.token) {
    throw new Error('KiBrain is not configured: endpoint and token are required.');
  }

  const errors = new Map<string, ErrorLogEntry>(
    (await deps.loadErrors()).map((entry) => [entry.chat.sourceChatId, entry]),
  );

  let retried = 0;
  let failed = 0;

  // 1. Retry chats that failed on a previous run.
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
        lastMessage: messageOf(error),
      });
      failed += 1;
    }
  }

  // 2. Detect and transmit fresh conversations.
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
        lastMessage: messageOf(error),
      });
      failed += 1;
    }
  }

  await deps.saveErrors([...errors.values()]);

  return { detected: conversations.length, retried, failed };
}
