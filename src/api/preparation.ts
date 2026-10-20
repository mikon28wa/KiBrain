/**
 * Deterministic chat preparation (no AI calls).
 *
 * The preparation selects relevant messages via a relevance score (term matches
 * when search terms are supplied, otherwise a position/length heuristic), keeps
 * system/user/assistant roles as separate structured parts, truncates long
 * messages, and enforces a `max_tokens` budget by compressing the least
 * relevant messages first. On budget overrun it truncates deterministically
 * instead of erroring.
 */

export const DEFAULT_MAX_TOKENS = 4000;

/** Fixed per-message overhead (role label + separators) in estimated tokens. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Approximate token count: ~4 characters per token (deterministic, no AI). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface PreparedMessageInput {
  role: string;
  content: string;
}

export interface PrepareInput {
  id: string;
  title: string;
  sourceProvider: string;
  sourceChatId: string;
  messages: PreparedMessageInput[];
}

export interface PreparedMessage {
  role: string;
  content: string;
  /** Original position in the chat. */
  index: number;
  truncated: boolean;
}

export interface PreparedChat {
  id: string;
  title: string;
  sourceProvider: string;
  sourceChatId: string;
  truncated: boolean;
  messages: PreparedMessage[];
}

export interface PreparationOptions {
  maxTokens?: number;
  searchTerms?: string[];
}

/** Total estimated token cost of a list of prepared messages. */
export function estimatePreparedTokens(messages: PreparedMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD_TOKENS, 0);
}

function relevanceScore(message: PreparedMessageInput, index: number, searchTerms: string[]): number {
  if (searchTerms.length > 0) {
    const lower = message.content.toLowerCase();
    let matches = 0;
    for (const term of searchTerms) {
      const t = term.toLowerCase();
      let pos = lower.indexOf(t);
      while (pos !== -1) {
        matches += 1;
        pos = lower.indexOf(t, pos + t.length);
      }
    }
    // Term matches dominate; the position breaks ties deterministically.
    return matches * 1_000_000 + index;
  }

  // Position/length heuristic: position dominates so earlier messages compress
  // first; length is a secondary factor that never overrides position.
  return index * 1_000_000 + Math.min(message.content.length, 999_999);
}

function truncateToTokens(text: string, maxContentTokens: number): string {
  if (maxContentTokens <= 0) return '';
  const maxChars = maxContentTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function messageCost(message: PreparedMessageInput): number {
  return estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
}

export function prepareChat(input: PrepareInput, options: PreparationOptions = {}): PreparedChat {
  const maxTokens = Math.max(0, Math.floor(options.maxTokens ?? DEFAULT_MAX_TOKENS));
  const searchTerms = options.searchTerms ?? [];
  const { messages } = input;

  const relevance = messages.map((m, i) => relevanceScore(m, i, searchTerms));

  // Most relevant first: earlier (lower-index) messages compress first when no
  // search terms are supplied.
  const priority = messages.map((_, i) => i).sort((a, b) => relevance[b] - relevance[a]);

  const allocations = new Map<number, number>();
  let remaining = maxTokens;
  for (const i of priority) {
    const cost = messageCost(messages[i]);
    if (cost <= remaining) {
      allocations.set(i, cost);
      remaining -= cost;
    } else if (remaining >= MESSAGE_OVERHEAD_TOKENS) {
      // Keep this message but truncate it to the remaining budget.
      allocations.set(i, remaining);
      remaining = 0;
      break;
    } else {
      // Not enough room even for the overhead: drop this and everything less relevant.
      break;
    }
  }

  const prepared: PreparedMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (!allocations.has(i)) continue;
    const allocated = allocations.get(i)!;
    const fullCost = messageCost(messages[i]);
    if (allocated >= fullCost) {
      prepared.push({ role: messages[i].role, content: messages[i].content, index: i, truncated: false });
    } else {
      const contentTokens = Math.max(0, allocated - MESSAGE_OVERHEAD_TOKENS);
      prepared.push({
        role: messages[i].role,
        content: truncateToTokens(messages[i].content, contentTokens),
        index: i,
        truncated: true,
      });
    }
  }

  return {
    id: input.id,
    title: input.title,
    sourceProvider: input.sourceProvider,
    sourceChatId: input.sourceChatId,
    truncated: prepared.length !== messages.length || prepared.some((m) => m.truncated),
    messages: prepared,
  };
}
