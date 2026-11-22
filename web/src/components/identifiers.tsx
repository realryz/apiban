function shorten(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function Identifiers({ list }: { list: string[] }) {
  const tokens = list.filter((identifier) => identifier.startsWith('token:')).length;
  const shown = list.filter((identifier) => !identifier.startsWith('token:'));

  return (
    <div className="id-chips">
      {shown.map((identifier) => {
        const [kind, ...rest] = identifier.split(':');
        return (
          <span key={identifier} className="id-chip" title={identifier}>
            {kind} <b>{shorten(rest.join(':'))}</b>
          </span>
        );
      })}
      {tokens > 0 && (
        <span className="id-chip">
          <b>{tokens}</b> hw tokens
        </span>
      )}
    </div>
  );
}
