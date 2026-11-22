import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DiscordIcon } from '@/components/icons';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  forbidden: 'You need the staff role on the Discord server to use this panel.',
  state: 'The sign-in link expired. Try again.',
  oauth: 'Discord sign-in failed. Try again.',
  discord: 'Your role could not be checked on Discord. Try again in a moment.',
  cancelled: 'Sign-in was cancelled.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect('/');
  const { error } = await searchParams;

  return (
    <main className="shell login">
      <div className="login-card">
        <p className="eyebrow">
          <span aria-hidden="true">✹</span> apiban
        </p>
        <h1 className="display page-title">
          Ban <em>panel</em>
        </h1>
        <p className="lead page-lead">
          Sign in with Discord. Only members with the staff role on the server get in.
        </p>
        {error && (
          <div className="callout" role="alert">
            <p className="prose">{ERRORS[error] ?? ERRORS.oauth}</p>
          </div>
        )}
        <a href="/auth/login" className="btn btn-primary btn-block">
          <DiscordIcon /> Sign in with Discord
        </a>
      </div>
    </main>
  );
}
