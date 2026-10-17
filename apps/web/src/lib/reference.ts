'use client';

/**
 * Справочные данные, одинаковые для всех пользователей: анкета привычек и
 * города. Загружаются один раз за сессию вкладки и переиспользуются экранами.
 */
import type { Problem, ProfileSchemas } from '@sozhiteli/api-client';
import { useEffect, useState } from 'react';

import { useApi } from './api';

export type Questionnaire = ProfileSchemas['Questionnaire'];
export type City = ProfileSchemas['City'];

type Loaded<T> = { data?: T; error?: Problem | null };

let questionnaireCache: Promise<Loaded<Questionnaire>> | null = null;
let citiesCache: Promise<Loaded<City[]>> | null = null;

function useCached<T>(
  getCache: () => Promise<Loaded<T>> | null,
  setCache: (p: Promise<Loaded<T>> | null) => void,
  load: () => Promise<Loaded<T>>,
): Loaded<T> & { loading: boolean } {
  const [state, setState] = useState<Loaded<T> & { loading: boolean }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    let pending = getCache();
    if (!pending) {
      pending = load();
      setCache(pending);
    }
    pending.then((result) => {
      // Ошибку не кэшируем: следующий экран попробует снова.
      if (result.error !== undefined && result.data === undefined) setCache(null);
      if (!cancelled) setState({ ...result, loading: false });
    });
    return () => {
      cancelled = true;
    };
    // load использует клиент API, который не меняется в течение сессии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

export function useQuestionnaire() {
  const api = useApi();
  return useCached(
    () => questionnaireCache,
    (p) => (questionnaireCache = p),
    async () => {
      const { data, error } = await api.profile.GET('/v1/questionnaire');
      return { data, error: error ?? (data ? undefined : null) };
    },
  );
}

export function useCities() {
  const api = useApi();
  return useCached(
    () => citiesCache,
    (p) => (citiesCache = p),
    async () => {
      const { data, error } = await api.profile.GET('/v1/cities');
      return { data: data?.items, error: error ?? (data ? undefined : null) };
    },
  );
}
