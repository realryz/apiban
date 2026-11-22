import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { BanButton } from '@/components/ban-button';
import { Identifiers } from '@/components/identifiers';
import { Logo } from '@/components/logo';
import { RevokeButton } from '@/components/revoke-button';
import { Time } from '@/components/time';
import { ApiError, api, requireKey } from '@/lib/api';
import type { BanList, BanStatus, Me, Players } from '@/lib/types';
import { logout } from './actions';

const PAGE_SIZE = 25;
const FILTERS = ['all', 'active', 'expired', 'revoked'] as const;

type Search = { q?: string; status?: string; page?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const key = await requireKey();
  const search = await searchParams;
  const status = FILTERS.find((filter) => filter === search.status) ?? 'all';
  const q = search.q?.trim() ?? '';
  const page = Math.max(1, Number.parseInt(search.page ?? '', 10) || 1);

  let me: Me, live: Players, list: BanList, active: BanList, all: BanList;
  try {
    [me, live, list, active, all] = await Promise.all([
      api.me(key),
      api.players(key),
      api.bans(key, { status, q, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) }),
      api.bans(key, { status: 'active', limit: '1' }),
      api.bans(key, { limit: '1' }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?expired=1');
    return <Unreachable message={(error as Error).message} />;
  }

  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const href = (changes: Partial<Search>) => {
    const params = new URLSearchParams({ status, q, page: String(page), ...changes });
    if (!params.get('q')) params.delete('q');
    if (params.get('status') === 'all') params.delete('status');
    if (params.get('page') === '1') params.delete('page');
    return `/?${params}`;
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <AutoRefresh seconds={10} />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <div className="flex items-center gap-2">
          <ServerStatus live={live} />
          <span className="hidden px-2 text-sm text-zinc-500 sm:inline">
            Signed in as <span className="text-zinc-200">{me.name}</span>
          </span>
          <form action={logout}>
            <button type="submit" className="btn btn-ghost">
              Log out
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Players online" value={live.online ? live.players.length : '—'} accent={live.online} />
        <Stat label="Active bans" value={active.total} />
        <Stat label="Bans all time" value={all.total} />
      </section>

      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="font-semibold">Online players</h2>
          <div className="ml-auto">
            <BanButton players={live.players} className="btn btn-primary">
              New ban
            </BanButton>
          </div>
        </div>

        {!live.online ? (
          <Empty
            title="The FiveM server is offline"
            text={
              live.last_heartbeat ? (
                <>
                  Last heartbeat <Time ts={live.last_heartbeat} />. Check that the apiban resource is running.
                </>
              ) : (
                'No heartbeat yet. Start the apiban resource on your server.'
              )
            }
          />
        ) : live.players.length === 0 ? (
          <Empty title="Nobody is online" text="Players show up here as soon as they join." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="th w-16">ID</th>
                  <th className="th">Name</th>
                  <th className="th">Identifiers</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {live.players.map((player) => (
                  <tr key={player.id} className="transition hover:bg-white/[0.02]">
                    <td className="td font-mono text-zinc-400">{player.id}</td>
                    <td className="td font-medium">{player.name}</td>
                    <td className="td">
                      <Identifiers list={player.identifiers} />
                    </td>
                    <td className="td text-right">
                      <BanButton
                        players={live.players}
                        player={player}
                        className="btn border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        Ban
                      </BanButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="font-semibold">Bans</h2>
          <nav className="flex gap-1 rounded-lg bg-zinc-950/70 p-1 text-sm">
            {FILTERS.map((filter) => (
              <Link
                key={filter}
                href={href({ status: filter, page: '1' })}
                className={`rounded-md px-2.5 py-1 capitalize transition ${
                  filter === status ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {filter}
              </Link>
            ))}
          </nav>
          <form method="get" className="w-full sm:ml-auto sm:w-72">
            {status !== 'all' && <input type="hidden" name="status" value={status} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, reason, identifier, #id"
              aria-label="Search bans"
              className="input"
            />
          </form>
        </div>

        {list.bans.length === 0 ? (
          <Empty
            title={q ? 'No bans match your search' : 'No bans here'}
            text="Bans made from the dashboard, an iPhone shortcut or in game appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="th">Ban</th>
                  <th className="th">Player</th>
                  <th className="th">Reason</th>
                  <th className="th">By</th>
                  <th className="th">Banned</th>
                  <th className="th">Expires</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {list.bans.map((ban) => (
                  <tr key={ban.id} className="transition hover:bg-white/[0.02]">
                    <td className="td whitespace-nowrap">
                      <div className="font-mono text-zinc-300">#{ban.id}</div>
                      <StatusBadge status={ban.status} />
                    </td>
                    <td className="td min-w-40">
                      <div className="font-medium">{ban.player_name}</div>
                      <details className="group mt-1">
                        <summary className="cursor-pointer list-none text-xs text-zinc-500 hover:text-zinc-300">
                          {ban.identifiers.length} identifier{ban.identifiers.length === 1 ? '' : 's'} <span className="group-open:hidden">▸</span>
                          <span className="hidden group-open:inline">▾</span>
                        </summary>
                        <div className="mt-2">
                          <Identifiers list={ban.identifiers} />
                        </div>
                      </details>
                    </td>
                    <td className="td max-w-xs">
                      <p className="line-clamp-2 text-zinc-300" title={ban.reason}>
                        {ban.reason}
                      </p>
                    </td>
                    <td className="td whitespace-nowrap text-zinc-400">
                      {ban.banned_by}
                      {ban.revoked_by && <div className="text-xs text-zinc-600">unbanned by {ban.revoked_by}</div>}
                    </td>
                    <td className="td whitespace-nowrap text-zinc-400">
                      <Time ts={ban.created_at} />
                    </td>
                    <td className="td whitespace-nowrap text-zinc-400">
                      {ban.expires_at ? <Time ts={ban.expires_at} /> : <span className="text-red-300">Never</span>}
                    </td>
                    <td className="td text-right">
                      {ban.status === 'active' && <RevokeButton id={ban.id} name={ban.player_name} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-sm text-zinc-500">
            <span>
              Page {page} of {pages} · {list.total} bans
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={href({ page: String(page - 1) })} className="btn btn-outline px-3 py-1">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={href({ page: String(page + 1) })} className="btn btn-outline px-3 py-1">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function ServerStatus({ live }: { live: Players }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
        live.online
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
      }`}
    >
      <span className={`size-1.5 rounded-full ${live.online ? 'animate-pulse bg-emerald-400' : 'bg-zinc-500'}`} />
      {live.online ? 'Server online' : 'Server offline'}
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="card px-5 py-4">
      <div className="label">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${accent ? 'text-emerald-300' : ''}`}>{value}</div>
    </div>
  );
}

const STATUS_STYLES: Record<BanStatus, string> = {
  active: 'bg-red-500/15 text-red-300 border-red-500/30',
  expired: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  revoked: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
};

function StatusBadge({ status }: { status: BanStatus }) {
  return (
    <span className={`mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[11px] capitalize ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function Empty({ title, text }: { title: string; text: React.ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium text-zinc-300">{title}</p>
      <p className="mt-1 text-sm text-zinc-500">{text}</p>
    </div>
  );
}

function Unreachable({ message }: { message: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-md p-6 text-center">
        <p className="font-semibold">The API is not reachable</p>
        <p className="mt-2 text-sm text-zinc-400">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className="btn btn-primary">
            Try again
          </Link>
          <form action={logout}>
            <button type="submit" className="btn btn-ghost">
              Log out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
