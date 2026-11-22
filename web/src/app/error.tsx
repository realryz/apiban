'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="shell page">
      <p className="eyebrow">Error</p>
      <h1 className="display page-title">
        Something <em>broke</em>
      </h1>
      <p className="lead page-lead">
        The panel could not load. Check that the API and Discord are reachable and that web/.env is complete.
      </p>
      <div className="btn-row" style={{ marginTop: '1.6rem' }}>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <a href="/auth/logout" className="btn">
          Log out
        </a>
      </div>
    </main>
  );
}
