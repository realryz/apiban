import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyCreator } from '@/components/key-creator';
import { Problem } from '@/components/problem';
import { RevokeButton } from '@/components/revoke-button';
import { Time } from '@/components/time';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { env } from '@/lib/env';
import type { UserKey } from '@/lib/types';

export const metadata: Metadata = { title: 'Settings' };

const MAX_KEYS = 10;

export default async function Settings() {
  const user = await requireUser();

  let keys: UserKey[];
  try {
    ({ keys } = await api.keys(user.id));
  } catch (error) {
    return <Problem message={(error as Error).message} />;
  }

  return (
    <div className="shell page">
      <header className="page-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/">Dashboard</Link>
          <span aria-hidden="true">/</span>
          <span>Settings</span>
        </nav>
        <h1 className="display page-title">
          API <em>keys</em>
        </h1>
        <p className="lead page-lead">
          Keys let iPhone shortcuts and scripts ban players. Every key belongs to your Discord account and stops working
          when you lose the staff role.
        </p>
      </header>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">Create a key</p>
        </div>
        <KeyCreator disabled={keys.length >= MAX_KEYS} />
      </section>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">
            Your keys · {keys.length}/{MAX_KEYS}
          </p>
        </div>
        {keys.length === 0 ? (
          <div className="empty">
            <strong>No keys yet</strong>
            <span>Create one above to ban from your iPhone.</span>
          </div>
        ) : (
          <div className="stack">
            {keys.map((key) => (
              <div key={key.id} className="list-row">
                <span className="list-index mono">#{key.id}</span>
                <div className="list-main">
                  <strong>{key.name}</strong>
                  <span>
                    created <Time ts={key.created_at} /> ·{' '}
                    {key.last_used_at ? (
                      <>
                        last used <Time ts={key.last_used_at} />
                      </>
                    ) : (
                      'never used'
                    )}
                  </span>
                </div>
                <RevokeButton kind="key" id={key.id} name={key.name} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">Use a key</p>
        </div>
        <pre className="code mono">
          <b>curl</b> -X POST {env('APIBAN_API_URL')}/v1/bans \{'\n'}
          {'  '}-H <b>&quot;Authorization: Bearer apiban_…&quot;</b> \{'\n'}
          {'  '}-H &quot;Content-Type: application/json&quot; \{'\n'}
          {'  '}-d &apos;{'{'}&quot;player&quot;: 12, &quot;reason&quot;: &quot;Aimbot&quot;, &quot;duration&quot;: &quot;7d&quot;{'}'}&apos;
        </pre>
        <p className="lead" style={{ marginTop: '0.9rem' }}>
          Bans made with a key are signed as{' '}
          <span className="code-chip mono">
            {user.username} (key name)
          </span>
          . The README explains how to build the iPhone shortcut.
        </p>
      </section>
    </div>
  );
}
