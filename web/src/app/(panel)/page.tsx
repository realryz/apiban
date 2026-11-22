import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { BanButton } from '@/components/ban-button';
import { Identifiers } from '@/components/identifiers';
import { Problem } from '@/components/problem';
import { RevokeButton } from '@/components/revoke-button';
import { Time } from '@/components/time';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import type { BanList, BanStatus, Players } from '@/lib/types';

const PAGE_SIZE = 25;
const FILTERS = ['all', 'active', 'expired', 'revoked'] as const;

type Search = { q?: string; status?: string; page?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const search = await searchParams;
  const status = FILTERS.find((filter) => filter === search.status) ?? 'all';
  const q = search.q?.trim() ?? '';
  const page = Math.max(1, Number.parseInt(search.page ?? '', 10) || 1);

  let live: Players, list: BanList, active: BanList, all: BanList;
  try {
    [live, list, active, all] = await Promise.all([
      api.players(),
      api.bans({ status, q, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) }),
      api.bans({ status: 'active', limit: '1' }),
      api.bans({ limit: '1' }),
    ]);
  } catch (error) {
    return <Problem message={(error as Error).message} />;
  }

  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const href = (changes: Partial<Record<keyof Search, string>>) => {
    const params = new URLSearchParams({ status, q, page: String(page), ...changes });
    if (!params.get('q')) params.delete('q');
    if (params.get('status') === 'all') params.delete('status');
    if (params.get('page') === '1') params.delete('page');
    const query = params.toString();
    return query ? `/?${query}` : '/';
  };

  return (
    <div className="shell page">
      <AutoRefresh seconds={10} />

      <header className="page-head">
        <p className="eyebrow">
          <span className={live.online ? 'live-dot' : 'idle-dot'} aria-hidden="true" />
          {live.online ? 'Server online' : 'Server offline'}
        </p>
        <h1 className="display page-title">
          Ban <em>panel</em>
        </h1>
        <p className="lead page-lead">
          Welcome back, {user.name}. Bans you make here are signed as <span className="code-chip mono">{user.username}</span>
        </p>
      </header>

      <div className="cells">
        <Stat label="Players online" value={live.online ? live.players.length : '—'} accent={live.online} />
        <Stat label="Active bans" value={active.total} />
        <Stat label="Bans all time" value={all.total} />
      </div>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">Online players · {live.players.length}</p>
          <div>
            <BanButton players={live.players} className="btn btn-primary btn-sm">
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
          <div className="stack">
            {live.players.map((player) => (
              <div key={player.id} className="list-row">
                <span className="list-index mono">#{player.id}</span>
                <div className="list-main">
                  <strong>{player.name}</strong>
                  <Identifiers list={player.identifiers} />
                </div>
                <BanButton players={live.players} player={player} className="btn btn-sm">
                  Ban
                </BanButton>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">Bans · {list.total}</p>
        </div>

        <div className="toolbar">
          <nav className="btn-row" aria-label="Filter bans">
            {FILTERS.map((filter) => (
              <Link
                key={filter}
                href={href({ status: filter, page: '1' })}
                aria-current={filter === status ? 'page' : undefined}
                className="btn btn-sm"
                style={{ textTransform: 'capitalize' }}
              >
                {filter}
              </Link>
            ))}
          </nav>
          <form method="get">
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
            text="Bans from the panel, an iPhone shortcut or the game show up here."
          />
        ) : (
          <div className="stack">
            {list.bans.map((ban) => (
              <div key={ban.id} className="ban-row">
                <span className="list-index mono">#{ban.id}</span>
                <div className="list-main">
                  <strong>
                    {ban.player_name}
                    <StatusTag status={ban.status} />
                  </strong>
                  <span title={ban.reason}>{ban.reason}</span>
                  <details className="ids">
                    <summary>
                      {ban.identifiers.length} identifier{ban.identifiers.length === 1 ? '' : 's'}
                    </summary>
                    <Identifiers list={ban.identifiers} />
                  </details>
                </div>
                <div className="ban-meta">
                  <span>
                    by <b>{ban.banned_by}</b>
                  </span>
                  <span>
                    <Time ts={ban.created_at} /> ·{' '}
                    {ban.expires_at ? (
                      <>
                        {ban.status === 'expired' ? 'ended' : 'ends'} <Time ts={ban.expires_at} />
                      </>
                    ) : (
                      'permanent'
                    )}
                  </span>
                  {ban.revoked_by && (
                    <span>
                      unbanned by <b>{ban.revoked_by}</b>
                    </span>
                  )}
                </div>
                <div className="row-action">
                  {ban.status === 'active' && <RevokeButton kind="ban" id={ban.id} name={ban.player_name} />}
                </div>
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="pager">
            <span>
              Page {page} of {pages}
            </span>
            <div className="btn-row">
              {page > 1 && (
                <Link href={href({ page: String(page - 1) })} className="btn btn-sm">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={href({ page: String(page + 1) })} className="btn btn-sm">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="cell">
      <span className="eyebrow">{label}</span>
      <span className="stat-value">{accent ? <em>{value}</em> : value}</span>
    </div>
  );
}

function StatusTag({ status }: { status: BanStatus }) {
  return <span className={status === 'active' ? 'tag' : 'tag tag-muted'}>{status === 'revoked' ? 'unbanned' : status}</span>;
}

function Empty({ title, text }: { title: string; text: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
