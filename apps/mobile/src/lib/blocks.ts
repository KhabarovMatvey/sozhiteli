/**
 * Повторяет apps/web/src/lib/blocks.ts, но перечитывается при фокусе экрана.
 *
 * Список заблокированных текущим пользователем. Matching о блокировках не
 * знает (они принадлежат Interaction), поэтому заблокированных из выдачи и
 * списков запросов убирает клиент.
 */
import type { Problem } from '@sozhiteli/api-client';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useApi } from './api';

export interface Blocks {
  /** undefined - список ещё загружается. */
  ids?: Set<string>;
  problem: Problem | null;
  reload: () => Promise<void>;
}

export function useBlocks(): Blocks {
  const api = useApi();
  const [ids, setIds] = useState<Set<string> | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await api.interaction.GET('/v1/blocks');
    if (data) {
      setIds(new Set(data.items.map((b) => b.user_id)));
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
