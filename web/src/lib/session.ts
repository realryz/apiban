import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { env, isHttps } from './env';

export const SESSION_COOKIE = 'apiban_session';
export const STATE_COOKIE = 'apiban_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionUser = { id: string; username: string; name: string; avatar: string | null };

function sign(payload: string) {
  return createHmac('sha256', env('SESSION_SECRET')).update(payload).digest('base64url');
}

export function encodeSession(user: SessionUser) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ ...user, exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decodeSession(value: string): SessionUser | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
    return { id: data.id, username: data.username, name: data.name, avatar: data.avatar };
  } catch {
    return null;
  }
}

export const getSession = cache(async () => {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value ? decodeSession(value) : null;
});

export function sessionCookie(value: string) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isHttps(),
    path: '/',
    maxAge: value ? SESSION_MAX_AGE : 0,
  };
}

export function stateCookie(value: string) {
  return {
    name: STATE_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isHttps(),
    path: '/auth',
    maxAge: value ? 600 : 0,
  };
}
