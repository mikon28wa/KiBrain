import type { AuthApi } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function extractError(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.error === 'string') return b.error;
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const first = b.errors[0] as { message?: unknown };
    if (typeof first?.message === 'string') return first.message;
  }
  return undefined;
}

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '';

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    throw new ApiError(response.status, extractError(body) ?? `Request failed (${response.status}).`);
  }
  return body;
}

export const authApi: AuthApi = {
  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  requestPasswordReset: (email) =>
    request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/auth/password-reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
};
