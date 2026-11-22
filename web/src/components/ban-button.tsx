'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { createBan, type FormState } from '@/app/actions';
import type { Player } from '@/lib/types';

const DURATIONS = [
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '1 week' },
  { value: '30d', label: '30 days' },
  { value: 'perm', label: 'Permanent' },
  { value: 'custom', label: 'Custom' },
];

const REASONS = ['Cheating', 'Exploiting', 'Toxic behaviour', 'RDM / VDM', 'Ban evasion'];

type Props = {
  /** Everyone online, offered in the player picker. */
  players: Player[];
  /** Ban this player directly (row button). */
  player?: Player;
  className: string;
  children: React.ReactNode;
};

export function BanButton({ players, player, className, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState<FormState, FormData>(createBan, {});
  const [target, setTarget] = useState<'player' | 'identifiers'>('player');
  const [duration, setDuration] = useState('7d');
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<string>();
  const [openedAt, setOpenedAt] = useState(0);

  useEffect(() => {
    if (!state.message) return;
    dialog.current?.close();
    form.current?.reset();
    setReason('');
    setDuration('7d');
    setToast(state.message);
    const timer = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(timer);
  }, [state]);

  function open() {
    setTarget(player || players.length > 0 ? 'player' : 'identifiers');
    setOpenedAt(Date.now());
    dialog.current?.showModal();
  }

  // Submitting through a transition (instead of <form action>) keeps the inputs when the API rejects the ban.
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  // Only show errors from submissions made since the dialog was last opened.
  const showError = state.error && (state.at ?? 0) > openedAt;

  return (
    <>
      <button type="button" onClick={open} className={className}>
        {children}
      </button>

      <dialog
        ref={dialog}
        onClick={(event) => event.target === dialog.current && dialog.current.close()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl text-left border border-white/10 bg-zinc-900 p-0 text-zinc-100 shadow-2xl shadow-black/60 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <form ref={form} onSubmit={submit} className="space-y-5 p-6">
          <div>
            <h2 className="text-lg font-semibold">{player ? `Ban ${player.name}` : 'New ban'}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Online players are kicked within a few seconds and see the ban screen.
            </p>
          </div>

          {player ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-zinc-950/60 px-4 py-3">
              <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-sm text-red-300">#{player.id}</span>
              <span className="font-medium">{player.name}</span>
              <input type="hidden" name="target" value="player" />
              <input type="hidden" name="player" value={player.id} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-950/70 p-1 text-sm">
                {(['player', 'identifiers'] as const).map((value) => (
                  <label
                    key={value}
                    className="cursor-pointer rounded-md px-3 py-1.5 text-center text-zinc-400 transition has-checked:bg-zinc-800 has-checked:text-zinc-100"
                  >
                    <input
                      type="radio"
                      name="target"
                      value={value}
                      checked={target === value}
                      onChange={() => setTarget(value)}
                      className="sr-only"
                    />
                    {value === 'player' ? 'Online player' : 'Identifiers'}
                  </label>
                ))}
              </div>

              {target === 'player' ? (
                <label className="block">
                  <span className="label">Player</span>
                  <select name="player" required className="input mt-1.5" defaultValue="">
                    <option value="" disabled>
                      {players.length ? 'Choose a player…' : 'Nobody is online'}
                    </option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.id} · {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="block">
                    <span className="label">Identifiers</span>
                    <textarea
                      name="identifiers"
                      required
                      rows={3}
                      placeholder={'license:1a2b3c…\ndiscord:123456789'}
                      className="input mt-1.5 font-mono text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="label">Player name (optional)</span>
                    <input name="name" maxLength={64} className="input mt-1.5" />
                  </label>
                </>
              )}
            </div>
          )}

          <div>
            <label className="block">
              <span className="label">Reason</span>
              <textarea
                name="reason"
                required
                maxLength={500}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="What did they do?"
                className="input mt-1.5"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-400 transition hover:border-red-500/50 hover:text-zinc-100"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <fieldset>
            <legend className="label">Duration</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DURATIONS.map((option) => (
                <label
                  key={option.value}
                  className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-white/20 has-checked:border-red-500/70 has-checked:bg-red-500/15 has-checked:text-white"
                >
                  <input
                    type="radio"
                    name="duration"
                    value={option.value}
                    checked={duration === option.value}
                    onChange={() => setDuration(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {duration === 'custom' && (
              <input
                name="custom_duration"
                required
                placeholder="e.g. 90m, 12h, 14d, 2w, 1y"
                className="input mt-2 font-mono"
              />
            )}
          </fieldset>

          {showError && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? 'Banning…' : 'Ban player'}
            </button>
          </div>
        </form>
      </dialog>

      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 flex text-left items-center gap-2 rounded-xl border border-emerald-500/30 bg-zinc-900 px-4 py-3 text-sm shadow-2xl shadow-black/50"
        >
          <span className="size-2 rounded-full bg-emerald-400" />
          {toast}
        </div>
      )}
    </>
  );
}
