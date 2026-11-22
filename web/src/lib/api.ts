import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { BanList, BanResult, Me, Players } from './types';

// Server-only: the API key lives in an httpOnly cookie and never reaches browser JavaScript.

export const SESSION_COOKIE = 'apiban_session';
const API_URL = (process.env.APIBAN_API_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(key: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, `Cannot reach the apiban API at ${API_URL}.`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error ?? `The API answered with HTTP ${response.status}.`);
  return data as T;
}

export const api = {
  me: (key: string) => request<Me>(key, '/v1/me'),
  players: (key: string) => request<Players>(key, '/v1/players'),
  bans: (key: string, query: Record<string, string>) =>
    request<BanList>(key, `/v1/bans?${new URLSearchParams(query)}`),
  createBan: (key: string, body: Record<string, unknown>) =>
    request<BanResult>(key, '/v1/bans', { method: 'POST', body }),
  revokeBan: (key: string, id: number) => request<BanResult>(key, `/v1/bans/${id}`, { method: 'DELETE' }),
};

/** The signed-in API key, or a redirect to the login page. */
export async function requireKey(): Promise<string> {
  const key = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!key) redirect('/login');
  return key;
}
