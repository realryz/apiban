import { type NextRequest, NextResponse } from 'next/server';
import { fetchDiscordUser, hasRole } from '@/lib/discord';
import { env } from '@/lib/env';
import { STATE_COOKIE, type SessionUser, encodeSession, sessionCookie, stateCookie } from '@/lib/session';

function redirectTo(path: string) {
  const response = NextResponse.redirect(new URL(path, env('APP_URL')));
  response.cookies.set(stateCookie(''));
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return redirectTo('/login?error=cancelled');

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || state !== request.cookies.get(STATE_COOKIE)?.value) return redirectTo('/login?error=state');

  let user: SessionUser;
  try {
    user = await fetchDiscordUser(code);
  } catch (error) {
    console.error((error as Error).message);
    return redirectTo('/login?error=oauth');
  }

  let allowed: boolean;
  try {
    allowed = await hasRole(user.id);
  } catch (error) {
    console.error((error as Error).message);
    return redirectTo('/login?error=discord');
  }
  if (!allowed) return redirectTo('/login?error=forbidden');

  const response = redirectTo('/');
  response.cookies.set(sessionCookie(encodeSession(user)));
  return response;
}
