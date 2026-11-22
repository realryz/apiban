import { env } from './env';
import type { SessionUser } from './session';

const DISCORD_API = 'https://discord.com/api/v10';
const ROLE_CACHE_MS = 60_000;

const roleCache = new Map<string, { allowed: boolean; at: number }>();

function redirectUri() {
  return `${env('APP_URL')}/auth/callback`;
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env('DISCORD_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function fetchDiscordUser(code: string): Promise<SessionUser> {
  const token = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: env('DISCORD_CLIENT_ID'),
      client_secret: env('DISCORD_CLIENT_SECRET'),
    }),
    cache: 'no-store',
  });
  if (!token.ok) throw new Error(`Discord token exchange failed with HTTP ${token.status}`);
  const { access_token } = (await token.json()) as { access_token: string };

  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Discord user lookup failed with HTTP ${response.status}`);
  const user = (await response.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };
  return { id: user.id, username: user.username, name: user.global_name || user.username, avatar: user.avatar };
}

export async function hasRole(userId: string): Promise<boolean> {
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.at < ROLE_CACHE_MS) return cached.allowed;

  try {
    const response = await fetch(`${DISCORD_API}/guilds/${env('DISCORD_GUILD_ID')}/members/${userId}`, {
      headers: { Authorization: `Bot ${env('DISCORD_BOT_TOKEN')}` },
      cache: 'no-store',
    });
    let allowed: boolean;
    if (response.status === 404) allowed = false;
    else if (response.ok) allowed = ((await response.json()) as { roles: string[] }).roles.includes(env('DISCORD_ROLE_ID'));
    else throw new Error(`Discord member lookup failed with HTTP ${response.status}`);
    roleCache.set(userId, { allowed, at: Date.now() });
    return allowed;
  } catch (error) {
    if (cached) return cached.allowed;
    throw error;
  }
}

export function avatarUrl(user: SessionUser) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}
