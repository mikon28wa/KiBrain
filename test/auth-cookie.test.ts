import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  createSessionCookie,
} from '../src/auth';

describe('session cookie', () => {
  it('sets HttpOnly, Secure and a 7-day max age', () => {
    const cookie = createSessionCookie('token-abc');

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe('token-abc');
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.sameSite).toBe('lax');
    expect(cookie.options.path).toBe('/');
    expect(cookie.options.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(SESSION_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('clears the session cookie with a zero max age', () => {
    const cookie = clearSessionCookie();

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe('');
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.maxAge).toBe(0);
  });
});
