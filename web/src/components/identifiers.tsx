function shorten(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** FiveM identifiers as compact chips; hardware tokens are only counted. */
export function Identifiers({ list }: { list: string[] }) {
  const tokens = list.filter((identifier) => identifier.startsWith('token:')).length;
  const shown = list.filter((identifier) => !identifier.startsWith('token:'));

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((identifier) => {
        const [kind, ...rest] = identifier.split(':');
        return (
          <span key={identifier} className="chip" title={identifier}>
            <span className="text-zinc-500">{kind}</span>
            <span className="font-mono text-zinc-300">{shorten(rest.join(':'))}</span>
          </span>
        );
      })}
      {tokens > 0 && <span className="chip">{tokens} hw tokens</span>}
    </div>
  );
}
