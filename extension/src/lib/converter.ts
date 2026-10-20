import type { BrainChatV1, Conversation } from './types';

const MAX_TITLE_LENGTH = 255;
const FALLBACK_TITLE = 'Chat';

/**
 * Convert a detected conversation into the brain.chat.v1 format. The stable
 * `sourceChatId` comes from the conversation id so repeated backups upsert the
 * same chat on the server instead of duplicating it.
 */
export function toBrainChatV1(conversation: Conversation): BrainChatV1 {
  const firstMessage = conversation.messages[0]?.content;
  const title = conversation.title?.trim() || (firstMessage ? firstMessage.slice(0, MAX_TITLE_LENGTH) : FALLBACK_TITLE);

  return {
    sourceProvider: 'brain.chat.v1',
    sourceChatId: conversation.id,
    title,
    messages: conversation.messages,
    tags: [],
  };
}
