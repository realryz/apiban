'use client';

import { useEffect, useState } from 'react';

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const STEPS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [3600, 'minute'],
  [86400, 'hour'],
  [604800, 'day'],
  [2629800, 'week'],
  [31557600, 'month'],
  [Infinity, 'year'],
];

function relative(timestamp: number) {
  const diff = timestamp - Date.now() / 1000;
  let divisor = 1;
  for (const [limit, unit] of STEPS) {
    if (Math.abs(diff) < limit) return relativeFormat.format(Math.round(diff / divisor), unit);
    divisor = limit;
  }
}

export function Time({ ts }: { ts: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const date = new Date(ts * 1000);
  if (!mounted) return <time dateTime={date.toISOString()}>{date.toISOString().slice(0, 10)}</time>;
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}>
      {relative(ts)}
    </time>
  );
}
