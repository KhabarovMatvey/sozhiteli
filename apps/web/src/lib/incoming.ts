'use client';

/**
 * Число входящих запросов на контакт, ожидающих ответа, — для счётчика в шапке.
 * Уведомлений в MVP нет (docs/MVP_SCOPE.md), поэтому это единственный способ
 * заметить новый запрос. Обновляется при каждом переходе между страницами и
 * после ответа на запрос.
 */
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useApi } from './api';
import { useAuth } from './auth';

const listeners = new Set<() => void>();

/** Просит все счётчики перечитать число запросов (например, после ответа). */
export function refreshIncomingCount() {
  listeners.forEach((listener) => listener());
}

export function useIncomingCount(): number {
  const api = useApi();
  const auth = useAuth();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (auth.status !== 'authenticated') return;
    const { data } = await api.interaction.GET('/v1/contact-requests', {
      params: { query: { direction: 'incoming', limit: 50 } },
    });
    setCount(data ? data.items.filter((r) => r.status === 'pending').length : 0);
  }, [api, auth.status]);

  useEffect(() => {
    // Счётчик перечитывается при каждой смене страницы.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const listener = () => void load();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [load]);

  return auth.status === 'authenticated' ? count : 0;
}
