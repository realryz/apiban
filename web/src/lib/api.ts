import { env } from './env';
import type { BanList, BanResult, Players, UserKey } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; actor?: string } = {}): Promise<T> {
  const url = `${env('APIBAN_API_URL')}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${env('APIBAN_PANEL_KEY')}`,
        ...(init.actor && { 'X-Apiban-Actor': init.actor }),
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, `Cannot reach the apiban API at ${env('APIBAN_API_URL')}.`);
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401) throw new ApiError(401, 'The API rejected APIBAN_PANEL_KEY. Check web/.env.');
  if (!response.ok) throw new ApiError(response.status, data?.error ?? `The API answered with HTTP ${response.status}.`);
  return data as T;
}

export const api = {
  players: () => request<Players>('/v1/players'),
  bans: (query: Record<string, string>) => request<BanList>(`/v1/bans?${new URLSearchParams(query)}`),
  createBan: (actor: string, body: Record<string, unknown>) =>
    request<BanResult>('/v1/bans', { method: 'POST', body, actor }),
  revokeBan: (actor: string, id: number) => request<BanResult>(`/v1/bans/${id}`, { method: 'DELETE', actor }),
  keys: (discordId: string) => request<{ keys: UserKey[] }>(`/v1/keys?discord_id=${discordId}`),
  redeem: (discordId: string, code: string, name: string) =>
    request<{ token: string; key: UserKey }>('/v1/auth/redeem', {
      method: 'POST',
      body: { discord_id: discordId, code, name },
    }),
  revokeKey: (discordId: string, id: number) =>
    request<{ message: string }>(`/v1/keys/${id}?discord_id=${discordId}`, { method: 'DELETE' }),
};
