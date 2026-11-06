import type { MatchingSchemas, Problem } from '@sozhiteli/api-client';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Button, CandidateTile, Choice, ErrorBox, Field, Loading, Note, Screen, T } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useBlocks } from '@/lib/blocks';
import { useFavorites } from '@/lib/favorites';
import { useCities } from '@/lib/reference';

type Card = MatchingSchemas['CandidateCard'];

export default function CandidatesScreen() {
  const api = useApi();
  const blocks = useBlocks();
  const favorites = useFavorites();
  const [mode, setMode] = useState<'feed' | 'favorites'>('feed');
  const [saved, setSaved] = useState<Card[]>([]);
  const favoritesKey = [...(favorites.ids ?? [])].join(',');

  useEffect(() => {
    if (mode !== 'favorites' || !favoritesKey) return;
    api.matching
      .POST('/v1/candidates/lookup', { body: { user_ids: favoritesKey.split(',').slice(0, 50) } })
      .then(({ data }) => setSaved(data?.items ?? []));
  }, [api, mode, favoritesKey]);
  const cities = useCities();
  const [items, setItems] = useState<Card[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [districtDraft, setDistrictDraft] = useState('');
  const [district, setDistrict] = useState('');

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const filter = district.length >= 2 ? { district } : {};
      const { data, error } = await api.matching.GET('/v1/candidates', {
        params: { query: cursor ? { cursor, ...filter } : filter },
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
    [api, district],
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
  // Заблокированных убирает клиент: выдача Matching о блокировках не знает.
  const visible = items.filter((card) => !blocks.ids?.has(card.user_id));

  const modeSwitch = (
    <Choice
      options={[
        ['feed', 'Подходящие'],
        ['favorites', `Избранное${favorites.ids?.size ? ` (${favorites.ids.size})` : ''}`],
      ]}
      value={mode}
      onChange={setMode}
    />
  );

  if (mode === 'favorites') {
    const shown = favoritesKey ? saved.filter((c) => favorites.ids?.has(c.user_id)) : [];
    return (
      <Screen>
        {modeSwitch}
        {shown.length === 0 ? (
          <Note kind="empty" icon="☆">
            <T muted>Сохраняйте интересных людей кнопкой «В избранное» на их карточке.</T>
          </Note>
        ) : (
          shown.map((card) => (
            <CandidateTile
              key={card.user_id}
              card={card}
              cities={cities.data}
              onPress={() =>
                router.push({ pathname: '/candidate/[userId]', params: { userId: card.user_id } })
              }
            />
          ))
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {modeSwitch}
      <Field
        label="Район"
        placeholder="Например: центр"
        value={districtDraft}
        maxLength={50}
        returnKeyType="search"
        onChangeText={setDistrictDraft}
        onSubmitEditing={() => setDistrict(districtDraft.trim())}
      />
      {district ? (
        <Button
          title={'Сбросить фильтр «' + district + '»'}
          onPress={() => {
            setDistrictDraft('');
            setDistrict('');
          }}
        />
      ) : null}
      {visible.length === 0 ? (
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
      {visible.map((card) => (
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
