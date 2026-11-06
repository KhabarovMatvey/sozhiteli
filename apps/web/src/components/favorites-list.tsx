'use client';

/**
 * Избранное: сохранённые кандидаты со статусом общения, чтобы помнить, с кем
 * уже связывались (функция Should №15, истории S1-07b, S1-11b, S2-09b, S2-11b).
 * Карточки - из Matching (lookupCandidates), статусы - из запросов на контакт.
 */
import { type InteractionSchemas, type MatchingSchemas } from '@sozhiteli/api-client';
import { useEffect, useState } from 'react';

import { useApi } from '@/lib/api';
import type { City } from '@/lib/reference';

import { CandidateTile } from './candidate-summary';
import { EmptyState, Loading } from './states';

type Card = MatchingSchemas['CandidateCard'];
type Status = InteractionSchemas['ContactRequestStatus'];

const statusText: Record<Status, string> = {
  pending: 'запрос ждёт ответа',
  accepted: 'контакты открыты',
  declined: 'запрос отклонён',
};

export function FavoritesList({ ids, cities }: { ids: string[]; cities?: City[] }) {
  const api = useApi();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const key = ids.join(',');

  useEffect(() => {
    let cancelled = false;
    const userIds = key ? key.split(',') : [];
    Promise.all([
      userIds.length > 0
        ? api.matching.POST('/v1/candidates/lookup', { body: { user_ids: userIds.slice(0, 50) } })
        : Promise.resolve({ data: { items: [] as Card[] } }),
      ...(['outgoing', 'incoming'] as const).map((direction) =>
        api.interaction.GET('/v1/contact-requests', { params: { query: { direction, limit: 50 } } }),
      ),
    ]).then(([found, ...requests]) => {
      if (cancelled) return;
      const byId = new Map((found.data?.items ?? []).map((c) => [c.user_id, c]));
      setCards(userIds.map((id) => byId.get(id)).filter((c): c is Card => Boolean(c)));
      const next: Record<string, Status> = {};
      for (const r of requests.flatMap((page) => page.data?.items ?? [])) next[r.counterpart_id] = r.status;
      setStatuses(next);
    });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  if (!cards) return <Loading />;
  if (cards.length === 0) {
    return (
      <EmptyState icon="☆" title="В избранном пока никого">
        <p className="muted">Сохраняйте интересных людей кнопкой «В избранное» на их карточке.</p>
      </EmptyState>
    );
  }
  return (
    <ul className="grid-cards">
      {cards.map((card) => (
        <li key={card.user_id} className="stack stack-tight">
          <CandidateTile card={card} cities={cities} />
          <span className={`chip ${statuses[card.user_id] === 'accepted' ? 'chip-good' : ''}`}>
            {statuses[card.user_id] ? statusText[statuses[card.user_id]!] : 'ещё не связывались'}
          </span>
        </li>
      ))}
    </ul>
  );
}
