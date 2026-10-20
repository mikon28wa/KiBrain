import type { ChatMessage, Conversation } from './types';

/**
 * Minimal DOM-like abstraction so detection can be unit-tested without a real
 * browser DOM. The content script adapts `document` to this interface.
 */
export interface DomElement {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomElement[];
}

export interface DomRoot {
  querySelectorAll(selector: string): DomElement[];
}

export type PlatformDetector = (doc: DomRoot) => Conversation[];

/**
 * Generic detector: each conversation is a `[data-conversation-id]` block whose
 * messages are `[data-role]` elements. Platform-specific detectors can be
 * registered below and selected via {@link detectConversations}.
 */
export function detectGenericConversations(doc: DomRoot): Conversation[] {
  const conversations: Conversation[] = [];

  for (const element of doc.querySelectorAll('[data-conversation-id]')) {
    const id = element.getAttribute('data-conversation-id');
    if (!id) continue;

    const titleElement = element.querySelector('.title') ?? element.querySelector('[data-title]');
    const title = (titleElement?.textContent ?? '').trim();

    const messages: ChatMessage[] = [];
    for (const message of element.querySelectorAll('[data-role]')) {
      const role = message.getAttribute('data-role') ?? 'user';
      const content = (message.textContent ?? '').trim();
      messages.push({ role, content });
    }

    conversations.push({ id, title: title || undefined, messages });
  }

  return conversations;
}

const detectors: Record<string, PlatformDetector> = {
  generic: detectGenericConversations,
};

/** Detect conversations for a platform, falling back to the generic detector. */
export function detectConversations(platform: string, doc: DomRoot): Conversation[] {
  const detector = detectors[platform] ?? detectors.generic;
  return detector(doc);
}
