'use client';

import { useTransition } from 'react';
import { type FormState, revokeBan, revokeKey } from '@/app/actions';

type Props = {
  kind: 'ban' | 'key';
  id: number;
  name: string;
};

export function RevokeButton({ kind, id, name }: Props) {
  const [pending, startTransition] = useTransition();

  function revoke() {
    const question = kind === 'ban' ? `Unban ${name} (#${id})?` : `Revoke the API key "${name}"? It stops working right away.`;
    if (!confirm(question)) return;
    startTransition(async () => {
      const result: FormState = kind === 'ban' ? await revokeBan(id) : await revokeKey(id);
      if (result.error) alert(result.error);
    });
  }

  return (
    <button type="button" onClick={revoke} disabled={pending} className="btn btn-sm">
      {pending ? 'Working…' : kind === 'ban' ? 'Unban' : 'Revoke'}
    </button>
  );
}
