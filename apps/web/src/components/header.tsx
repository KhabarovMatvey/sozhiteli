'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { useIncomingCount } from '@/lib/incoming';

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Сожители — на главную">
      <span className="logo-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 11.5 12 4l9 7.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="15" r="2.6" fill="currentColor" />
          <circle cx="15" cy="15" r="2.6" fill="currentColor" />
        </svg>
      </span>
      сожители
    </Link>
  );
}

export function Header() {
  const auth = useAuth();
  const pathname = usePathname();
  const incoming = useIncomingCount();

  const sections = [
    { href: '/candidates', label: 'Кандидаты' },
    { href: '/requests', label: 'Запросы', count: incoming },
    { href: '/profile', label: 'Моя анкета' },
    { href: '/contact', label: 'Контакт' },
  ];

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Logo />
        {auth.status === 'authenticated' ? (
          <>
            <nav className="site-nav" aria-label="Разделы">
              {sections.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={pathname.startsWith(s.href) ? 'page' : undefined}
                >
                  {s.label}
                  {s.count ? (
                    <span className="counter" aria-label={`новых: ${s.count}`}>
                      {s.count}
                    </span>
                  ) : null}
                </Link>
              ))}
            </nav>
            <button type="button" className="btn btn-ghost" onClick={() => void auth.signOut()}>
              Выйти
            </button>
          </>
        ) : (
          <>
            <span className="spacer" />
            {auth.status === 'anonymous' && (
              <button type="button" className="btn btn-primary" onClick={() => void auth.signIn()}>
                Войти
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
