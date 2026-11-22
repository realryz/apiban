export function Problem({ message }: { message: string }) {
  return (
    <div className="shell page">
      <p className="eyebrow">
        <span className="idle-dot" /> API offline
      </p>
      <h1 className="display page-title">
        Can&apos;t reach <em>apiban</em>
      </h1>
      <p className="lead page-lead">{message}</p>
      <div className="btn-row" style={{ marginTop: '1.6rem' }}>
        <a href="" className="btn btn-primary">
          Try again
        </a>
      </div>
    </div>
  );
}
