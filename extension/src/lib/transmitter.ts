import type { BrainChatV1 } from './types';

/**
 * POST one chat to the KiBrain API. The token is sent only to the configured
 * endpoint — never anywhere else.
 */
export async function transmitChat(
  endpoint: string,
  token: string,
  chat: BrainChatV1,
  fetchImpl: typeof fetch = fetch,
): Promise<{ chatId: string }> {
  const base = endpoint.replace(/\/+$/, '');
  const response = await fetchImpl(`${base}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(chat),
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  return (await response.json()) as { chatId: string };
}
