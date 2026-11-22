import { Logo } from '@/components/logo';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="card mt-8 p-6">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Use a client key from the apiban API. Bans you make are logged under the key&apos;s name.
          </p>
          {expired && (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Your key is no longer valid. Sign in again.
            </p>
          )}
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-zinc-500">
          Create a key with <code className="text-zinc-400">apiban-api keygen &lt;name&gt;</code>
        </p>
      </div>
    </main>
  );
}
