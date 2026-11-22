import { Header } from '@/components/header';
import { requireUser } from '@/lib/auth';
import { avatarUrl } from '@/lib/discord';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <Header name={user.name} avatar={avatarUrl(user)} />
      <main>{children}</main>
      <footer className="site-footer">
        <div className="shell">
          <span>
            <span className="brand-mark" aria-hidden="true">
              ✹
            </span>{' '}
            · Made with <b>&lt;3</b>
          </span>
          <a href="https://github.com/realryz/apiban" target="_blank" rel="noopener noreferrer">
            github.com/realryz/apiban
          </a>
        </div>
      </footer>
    </>
  );
}
