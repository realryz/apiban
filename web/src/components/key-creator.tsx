'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { type KeyState, redeemKey } from '@/app/actions';
import { CopyButton } from '@/components/copy-button';

type Step = 'name' | 'code' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'code', label: 'Discord code' },
  { id: 'done', label: 'Your key' },
];

export function KeyCreator({ disabled }: { disabled: boolean }) {
  const [state, dispatch, pending] = useActionState<KeyState, FormData>(redeemKey, {});
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeSince, setCodeSince] = useState(0);
  const [token, setToken] = useState<string>();

  useEffect(() => {
    if (!state.token) return;
    setToken(state.token);
    setStep('done');
  }, [state]);

  function toCode(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCode('');
    setCodeSince(Date.now());
    setStep('code');
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  function reset() {
    setToken(undefined);
    setName('');
    setCode('');
    setStep('name');
  }

  const error = state.error && (state.at ?? 0) > codeSince ? state.error : undefined;

  return (
    <div className="panel">
      <div className="steps">
        {STEPS.map(({ id, label }, index) => (
          <span key={id} aria-current={step === id ? 'step' : undefined}>
            <b>{index + 1}</b>
            {label}
          </span>
        ))}
      </div>

      {step === 'name' && (
        <form onSubmit={toCode} className="form">
          <label className="field">
            <span className="field-label">Key name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              required
              placeholder="e.g. iPhone"
              className="input"
              disabled={disabled}
            />
          </label>
          {disabled ? (
            <p className="error">You have 10 API keys. Revoke one to create a new key.</p>
          ) : (
            <div>
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                Continue
              </button>
            </div>
          )}
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={submit} className="form">
          <div className="callout">
            <p className="prose">
              Run <b className="mono">/auth</b> on the Discord server. The bot sends you a <b>6-digit code</b> that is
              valid for <b>60 seconds</b>. Enter it here to create <b>{name}</b>.
            </p>
          </div>
          <input type="hidden" name="name" value={name} />
          <label className="field">
            <span className="field-label">Auth code</span>
            <input
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="000000"
              className="input otp"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="btn-row" style={{ gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" disabled={pending || code.length !== 6}>
              {pending ? 'Checking…' : 'Create key'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('name')}>
              Back
            </button>
          </div>
        </form>
      )}

      {step === 'done' && token && (
        <div className="form">
          <div className="callout">
            <p className="prose">
              <b>{state.name}</b> is ready. Copy the key now, it is shown only once.
            </p>
          </div>
          <div className="token">
            <code className="mono">{token}</code>
            <CopyButton value={token} />
          </div>
          <div>
            <button type="button" className="btn" onClick={reset}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
