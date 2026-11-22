'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export type FormState = { error?: string; message?: string; at?: number };
export type KeyState = { error?: string; token?: string; name?: string; at?: number };

function describe(error: unknown) {
  const text = (error as Error).message || 'Something went wrong.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function run(path: string, action: () => Promise<{ message: string }>): Promise<FormState> {
  try {
    const { message } = await action();
    revalidatePath(path);
    return { message, at: Date.now() };
  } catch (error) {
    return { error: describe(error), at: Date.now() };
  }
}

export async function createBan(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const field = (name: string) => String(form.get(name) ?? '').trim();

  const duration = field('duration') === 'custom' ? field('custom_duration') : field('duration');
  const body: Record<string, unknown> = { reason: field('reason'), duration };

  if (field('target') === 'identifiers') {
    body.identifiers = field('identifiers').split(/[\s,]+/).filter(Boolean);
    body.name = field('name');
  } else {
    const player = field('player');
    if (!/^\d+$/.test(player)) return { error: 'Pick an online player.', at: Date.now() };
    body.player = Number(player);
  }

  return run('/', () => api.createBan(user.username, body));
}

export async function revokeBan(id: number): Promise<FormState> {
  const user = await requireUser();
  return run('/', () => api.revokeBan(user.username, id));
}

export async function redeemKey(_: KeyState, form: FormData): Promise<KeyState> {
  const user = await requireUser();
  const name = String(form.get('name') ?? '').trim();
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!name) return { error: 'Give the key a name.', at: Date.now() };
  if (!/^\d{6}$/.test(code)) return { error: 'Enter the 6-digit code from Discord.', at: Date.now() };

  try {
    const { token, key } = await api.redeem(user.id, code, name);
    revalidatePath('/settings');
    return { token, name: key.name, at: Date.now() };
  } catch (error) {
    return { error: describe(error), at: Date.now() };
  }
}

export async function revokeKey(id: number): Promise<FormState> {
  const user = await requireUser();
  return run('/settings', () => api.revokeKey(user.id, id));
}
