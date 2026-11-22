'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutIcon, PaletteIcon } from '@/components/icons';
import { THEME_KEY, THEMES } from '@/lib/theme';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
];

function cycleTheme() {
  const root = document.documentElement;
  const current = THEMES.indexOf(root.dataset.theme as (typeof THEMES)[number]);
  const next = THEMES[(current + 1) % THEMES.length];
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
}

export function Header({ name, avatar }: { name: string; avatar: string }) {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="shell">
        <Link href="/" className="logo" aria-label="apiban dashboard">
          <span className="logo-mark" aria-hidden="true">
            ✹
          </span>
          apiban
        </Link>

        <nav className="nav" aria-label="Primary">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <span className="user">
            <img src={avatar} alt="" />
            <span>{name}</span>
          </span>
          <button type="button" className="square-btn" onClick={cycleTheme} aria-label="Switch color theme" title="Switch color theme">
            <PaletteIcon />
          </button>
          <a href="/auth/logout" className="square-btn" aria-label="Log out" title="Log out">
            <LogoutIcon />
          </a>
        </div>
      </div>
    </header>
  );
}
