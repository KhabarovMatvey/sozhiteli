'use client';

/**
 * Сохранённые текущим пользователем кандидаты (избранное). Принадлежат
 * Interaction, карточки к ним клиент берёт у Matching (lookupCandidates).
 */
import type { Problem } from '@sozhiteli/api-client';
import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    // Избранное при открытии экрана.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { ids, problem, reload };
}
