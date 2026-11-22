'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { type FormState, createBan } from '@/app/actions';
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
  players: Player[];
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

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  const error = state.error && (state.at ?? 0) > openedAt ? state.error : undefined;

  return (
    <>
      <button type="button" onClick={open} className={className}>
        {children}
      </button>

      <dialog ref={dialog} className="modal" onClick={(event) => event.target === dialog.current && dialog.current.close()}>
        <form ref={form} onSubmit={submit} className="modal-body form">
          <div>
            <p className="eyebrow">New ban</p>
            <h2 className="display modal-title">{player ? player.name : 'Ban a player'}</h2>
            <p className="lead">Online players are kicked within a few seconds and see the ban screen.</p>
          </div>

          {player ? (
            <div className="target">
              <span className="tag mono">#{player.id}</span>
              <span>{player.name}</span>
              <input type="hidden" name="target" value="player" />
              <input type="hidden" name="player" value={player.id} />
            </div>
          ) : (
            <>
              <div className="segmented">
                {(['player', 'identifiers'] as const).map((value) => (
                  <label key={value} className="pill">
                    <input type="radio" name="target" value={value} checked={target === value} onChange={() => setTarget(value)} />
                    {value === 'player' ? 'Online player' : 'Identifiers'}
                  </label>
                ))}
              </div>

              {target === 'player' ? (
                <label className="field">
                  <span className="field-label">Player</span>
                  <select name="player" required className="input" defaultValue="">
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
                  <label className="field">
                    <span className="field-label">Identifiers</span>
                    <textarea
                      name="identifiers"
                      required
                      rows={3}
                      placeholder={'license:1a2b3c…\ndiscord:123456789'}
                      className="input mono"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Player name (optional)</span>
                    <input name="name" maxLength={64} className="input" />
                  </label>
                </>
              )}
            </>
          )}

          <div className="field">
            <label className="field-label" htmlFor={`ban-reason-${player?.id ?? 'new'}`}>
              Reason
            </label>
            <textarea
              id={`ban-reason-${player?.id ?? 'new'}`}
              name="reason"
              required
              maxLength={500}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What did they do?"
              className="input"
            />
            <div className="presets">
              {REASONS.map((preset) => (
                <button key={preset} type="button" className="preset" onClick={() => setReason(preset)}>
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="field" role="radiogroup" aria-label="Duration">
            <span className="field-label">Duration</span>
            <div className="pills">
              {DURATIONS.map((option) => (
                <label key={option.value} className="pill">
                  <input
                    type="radio"
                    name="duration"
                    value={option.value}
                    checked={duration === option.value}
                    onChange={() => setDuration(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {duration === 'custom' && (
              <input name="custom_duration" required placeholder="e.g. 90m, 12h, 14d, 2w, 1y" className="input mono" />
            )}
          </div>

          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}

          <div className="modal-actions">
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
        <div role="status" className="toast">
          <span className="live-dot" />
          {toast}
        </div>
      )}
    </>
  );
}
