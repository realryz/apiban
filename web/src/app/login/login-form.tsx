'use client';

import { useActionState } from 'react';
import { login, type FormState } from '@/app/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});

  return (
    <form action={action} className="mt-5 space-y-4">
      <label className="block">
        <span className="label">API key</span>
        <input
          name="key"
          type="password"
          required
          autoComplete="current-password"
          placeholder="apiban_…"
          className="input mt-1.5 font-mono"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}
