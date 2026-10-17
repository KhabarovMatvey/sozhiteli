'use client';

import type { ReactNode } from 'react';

import { useAuth } from '@/lib/auth';

import { EmptyState, Loading } from './states';

/** Показывает содержимое только вошедшему пользователю. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.status === 'loading') return <Loading text="Проверяем вход…" />;
  if (auth.status === 'anonymous') {
    return (
      <EmptyState icon="🔐" title="Войдите, чтобы продолжить">
        <p className="muted">Раздел доступен после входа. Регистрация занимает минуту: почта и пароль.</p>
        <button type="button" className="btn btn-primary" onClick={() => void auth.signIn()}>
          Войти или зарегистрироваться
        </button>
      </EmptyState>
    );
  }
  return <>{children}</>;
}
