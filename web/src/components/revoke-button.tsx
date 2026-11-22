'use client';

import { useTransition } from 'react';
import { revokeBan } from '@/app/actions';

export function RevokeButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();

  function revoke() {
    if (!confirm(`Unban ${name} (#${id})?`)) return;
    startTransition(async () => {
      const result = await revokeBan(id);
      if (result.error) alert(result.error);
    });
  }

  return (
    <button type="button" onClick={revoke} disabled={pending} className="btn btn-outline px-2.5 py-1 text-xs">
      {pending ? 'Unbanning…' : 'Unban'}
    </button>
  );
}
