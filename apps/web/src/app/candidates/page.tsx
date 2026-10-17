'use client';

import { type MatchingSchemas, type Problem, type ProfileSchemas, formatBudget } from '@sozhiteli/api-client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { CandidateTile, cityName, shortDay } from '@/components/candidate-summary';
import { RequireAuth } from '@/components/require-auth';
import { EmptyState, ErrorMessage, TilesSkeleton } from '@/components/states';
import { useApi } from '@/lib/api';
import { type City, useCities } from '@/lib/reference';

type Card = MatchingSchemas['CandidateCard'];
type Profile = ProfileSchemas['Profile'];

/** Боковая панель: условия, по которым построена выдача. */
function MyConditions({ profile, cities }: { profile: Profile | null; cities?: City[] }) {
  if (!profile) return null;
  const city = cityName(cities, profile.city_id);
  return (
    <aside className="panel sticky">
      <h3 className="panel-title">Ваши условия</h3>
      <dl className="specs specs-stack">
        <div>
          <dt>Город</dt>
          <dd>{city ?? '—'}</dd>
        </div>
        <div>
          <dt>Бюджет в месяц</dt>
          <dd>{formatBudget(profile.budget_min_rub, profile.budget_max_rub)}</dd>
        </div>
        <div>
          <dt>Заселение</dt>
          <dd>
            {shortDay(profile.move_in_from)} — {shortDay(profile.move_in_to)}
          </dd>
        </div>
        <div>
          <dt>Сосед</dt>
          <dd>{profile.roommate_gender === 'same' ? 'только того же пола' : 'пол не важен'}</dd>
        </div>
      </dl>
      {profile.search_status === 'paused' && (
        <p className="info small mt-16">Ваша анкета на паузе: другие вас не видят.</p>
      )}
      <Link href="/profile" className="btn btn-block mt-16">
        Изменить условия
      </Link>
    </aside>
  );
}

function CandidatesScreen() {
  const api = useApi();
  const cities = useCities();
  const [profile, setProfile] = useState<Profile | null>(null);
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
    // Первая страница и собственная анкета при открытии экрана.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
    api.profile.GET('/v1/me/profile').then(({ data }) => setProfile(data ?? null));
  }, [api, load]);

  if (problem?.code === 'profile_not_ready') {
    return (
      <EmptyState icon="📝" title="Сначала заполните анкету">
        <p className="muted">
          Выдача строится по вашим условиям: городу, бюджету и срокам. Если анкета только что сохранена,
          подождите несколько секунд.
        </p>
        <div className="row row-center">
          <Link href="/profile" className="btn btn-primary">
            Заполнить анкету
          </Link>
          <button type="button" className="btn" onClick={() => void load(null)}>
            Обновить
          </button>
        </div>
      </EmptyState>
    );
  }
  if (problem) return <ErrorMessage problem={problem} />;

  const city = profile ? cityName(cities.data, profile.city_id) : undefined;

  return (
    <div className="layout-sidebar">
      <MyConditions profile={profile} cities={cities.data} />
      <section>
        <div className="page-head">
          <h1>Соседи{city ? ` в городе ${city}` : ''}</h1>
          {!loading && items.length > 0 && <span className="muted">новые анкеты сверху</span>}
        </div>
        {loading && items.length === 0 ? (
          <TilesSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon="🔎" title="Пока никого">
            <p className="muted">
              Под ваши условия — город, бюджет, сроки и пол соседа — сейчас никто не подходит. Загляните позже
              или расширьте бюджет и сроки.
            </p>
          </EmptyState>
        ) : (
          <ul className="grid-cards">
            {items.map((card) => (
              <li key={card.user_id}>
                <CandidateTile card={card} cities={cities.data} />
              </li>
            ))}
          </ul>
        )}
        {next && (
          <div className="center mt-24">
            <button type="button" className="btn" disabled={loading} onClick={() => void load(next)}>
              {loading ? 'Загружаем…' : 'Показать ещё'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function CandidatesPage() {
  return (
    <main className="page">
      <RequireAuth>
        <CandidatesScreen />
      </RequireAuth>
    </main>
  );
}
