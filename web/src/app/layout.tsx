import type { Metadata } from 'next';
import { DM_Sans, Fraunces, IBM_Plex_Mono } from 'next/font/google';
import { THEME_KEY, THEMES } from '@/lib/theme';
import './globals.css';

const body = DM_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const display = Fraunces({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'apiban', template: '%s - apiban' },
  description: 'Ban panel for your FiveM server',
  robots: { index: false, follow: false },
};

const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(
  THEMES,
)}.indexOf(t)>-1)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="default"
      className={`${body.variable} ${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
