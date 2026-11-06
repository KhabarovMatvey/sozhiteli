/**
 * Избранное текущего пользователя. Повторяет apps/web/src/lib/favorites.ts,
 * но перечитывается при фокусе экрана.
 */
import type { Problem } from '@sozhiteli/api-client';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useApi } from './api';

export interface Favorites {
  /** undefined - список ещё загружается. */
  ids?: Set<string>;
  problem: Problem | null;
  reload: () => Promise<void>;
}

export function useFavorites(): Favorites {
  const api = useApi();
  const [ids, setIds] = useState<Set<string> | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await api.interaction.GET('/v1/favorites');
    if (data) {
      setIds(new Set(data.items.map((f) => f.user_id)));
      setProblem(null);
    } else {
      setProblem(error ?? null);
    }
  }, [api]);

  // Вкладки остаются смонтированными, поэтому список перечитывается при
  // каждом возвращении на экран: блокировка могла появиться на карточке.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ids, problem, reload };
}
