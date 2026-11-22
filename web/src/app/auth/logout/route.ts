import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { sessionCookie } from '@/lib/session';

export async function GET(request: NextRequest) {
  const forbidden = request.nextUrl.searchParams.get('error') === 'forbidden';
  const response = NextResponse.redirect(new URL(forbidden ? '/login?error=forbidden' : '/login', env('APP_URL')));
  response.cookies.set(sessionCookie(''));
  return response;
}
