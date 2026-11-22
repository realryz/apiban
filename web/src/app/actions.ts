'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, SESSION_COOKIE, api, requireKey } from '@/lib/api';

export type FormState = { error?: string; message?: string; at?: number };

const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const key = String(form.get('key') ?? '').trim();
  if (!key) return { error: 'Paste your API key.' };

  try {
    const me = await api.me(key);
    if (me.role !== 'client') return { error: 'Server keys cannot sign in. Use a client key.' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { error: 'This API key is not valid.' };
    return { error: (error as Error).message };
  }

  (await cookies()).set(SESSION_COOKIE, key, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  redirect('/');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function createBan(_: FormState, form: FormData): Promise<FormState> {
  const key = await requireKey();
  const field = (name: string) => String(form.get(name) ?? '').trim();

  const duration = field('duration') === 'custom' ? field('custom_duration') : field('duration');
  const body: Record<string, unknown> = { reason: field('reason'), duration };

  if (field('target') === 'identifiers') {
    body.identifiers = field('identifiers').split(/[\s,]+/).filter(Boolean);
    body.name = field('name');
  } else {
    const player = field('player');
    if (!/^\d+$/.test(player)) return { error: 'Pick an online player.' };
    body.player = Number(player);
  }

  return mutate(() => api.createBan(key, body));
}

export async function revokeBan(id: number): Promise<FormState> {
  const key = await requireKey();
  return mutate(() => api.revokeBan(key, id));
}

async function mutate(run: () => Promise<{ message: string }>): Promise<FormState> {
  let expired = false;
  try {
    const { message } = await run();
    revalidatePath('/');
    return { message, at: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) expired = true;
    else return { error: (error as Error).message, at: Date.now() };
  }
  // redirect() throws, so it must run outside the try block.
  if (expired) redirect('/login?expired=1');
  return {};
}
