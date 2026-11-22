import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeUrl } from '@/lib/discord';
import { stateCookie } from '@/lib/session';

export async function GET() {
  const state = randomBytes(16).toString('hex');
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set(stateCookie(state));
  return response;
}
