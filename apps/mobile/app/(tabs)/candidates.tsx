import type { MatchingSchemas, Problem } from '@sozhiteli/api-client';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Button, CandidateTile, ErrorBox, Loading, Note, Screen, T } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useCities } from '@/lib/reference';

type Card = MatchingSchemas['CandidateCard'];

export default function CandidatesScreen() {
  const api = useApi();
  const cities = useCities();
  const [items, setItems] = useState<Card[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const { data, error } = await api.matching.GET('/v1/candidates', {
        params: { query: cursor ? { cursor } : {} },
      });
      setLoading(false);
      if (!data) {
        setProblem(error ?? null);
        return;
      }
      setProblem(null);
      setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
      setNext(data.next_cursor);
    },
    [api],
  );

  useEffect(() => {
    // Первая страница при открытии экрана.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  if (problem?.code === 'profile_not_ready') {
    return (
      <Screen>
        <Note kind="empty" icon="📝">
          <T bold size={18}>
            Сначала заполните анкету
          </T>
          <T muted>
            Выдача строится по вашим условиям: городу, бюджету и срокам. Если анкета только что сохранена,
            подождите несколько секунд.
          </T>
        </Note>
        <Button primary title="Заполнить анкету" onPress={() => router.navigate('/profile')} />
        <Button title="Обновить" onPress={() => void load(null)} />
      </Screen>
    );
  }
  if (problem) {
    return (
      <Screen>
        <ErrorBox problem={problem} />
        <Button title="Повторить" onPress={() => void load(null)} />
      </Screen>
    );
  }
  if (loading && items.length === 0) return <Loading />;

  return (
    <Screen>
      {items.length === 0 ? (
        <Note kind="empty" icon="🔍">
          <T bold size={18}>
            Пока никто не подходит
          </T>
          <T muted>
            Здесь появятся те, кто ищет соседа в вашем городе и совпадает с вами по бюджету, срокам и
            предпочтению по полу. Загляните позже или измените условия в анкете.
          </T>
        </Note>
      ) : (
        <T muted size={13}>
          Подходят по городу, бюджету, срокам и полу соседа · новые анкеты сверху
        </T>
      )}
      {items.map((card) => (
        <CandidateTile
          key={card.user_id}
          card={card}
          cities={cities.data}
          onPress={() => router.push({ pathname: '/candidate/[userId]', params: { userId: card.user_id } })}
        />
      ))}
      {next && (
        <Button
          title={loading ? 'Загрузка…' : 'Показать ещё'}
          disabled={loading}
          onPress={() => void load(next)}
        />
      )}
    </Screen>
  );
}
