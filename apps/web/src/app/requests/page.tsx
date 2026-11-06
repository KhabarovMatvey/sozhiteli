'use client';

import {
  type InteractionSchemas,
  type MatchingSchemas,
  type Problem,
  contactLabel,
  contactUrl,
  formatBudget,
  formatDate,
  problemMessage,
} from '@sozhiteli/api-client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AgreementEditor } from '@/components/agreement-editor';
import { Avatar } from '@/components/avatar';
import { MatchChip, candidateTitle, cityName } from '@/components/candidate-summary';
import { RequireAuth } from '@/components/require-auth';
import { EmptyState, ErrorMessage, Loading } from '@/components/states';
import { useApi } from '@/lib/api';
import { useBlocks } from '@/lib/blocks';
import { refreshIncomingCount, useIncomingCount } from '@/lib/incoming';
import { useCities } from '@/lib/reference';

type Direction = InteractionSchemas['Direction'];
type ContactRequest = InteractionSchemas['ContactRequest'];
type Card = MatchingSchemas['CandidateCard'];

const statusChips: Record<ContactRequest['status'], { text: string; tone: string }> = {
  pending: { text: 'ждёт ответа', tone: 'chip-mid' },
  accepted: { text: 'контакты открыты', tone: 'chip-good' },
  declined: { text: 'отклонён', tone: 'chip-low' },
};

function RequestsList({ direction }: { direction: Direction }) {
  const api = useApi();
  const cities = useCities();
  const [items, setItems] = useState<ContactRequest[]>([]);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [actionProblem, setActionProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openAgreement, setOpenAgreement] = useState<string | null>(null);
  const blocks = useBlocks();

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const { data, error } = await api.interaction.GET('/v1/contact-requests', {
        params: { query: cursor ? { direction, cursor } : { direction } },
      });
      if (!data) {
        setLoading(false);
        setProblem(error ?? null);
        return;
      }
      // Карточки собеседников страницы - одним запросом.
      const ids = [...new Set(data.items.map((r) => r.counterpart_id))];
      if (ids.length > 0) {
        const found = await api.matching.POST('/v1/candidates/lookup', { body: { user_ids: ids } });
        const fetched = found.data?.items ?? [];
        setCards((prev) => ({ ...prev, ...Object.fromEntries(fetched.map((c) => [c.user_id, c])) }));
      }
      setLoading(false);
      setProblem(null);
      setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
      setNext(data.next_cursor);
    },
    [api, direction],
  );

  useEffect(() => {
    // Первая страница при открытии вкладки.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  async function answer(id: string, action: 'accept' | 'decline') {
    setActionProblem(null);
    setBusy(id);
    const path =
      action === 'accept'
        ? '/v1/contact-requests/{request_id}/accept'
        : '/v1/contact-requests/{request_id}/decline';
    const { data, error } = await api.interaction.POST(path, { params: { path: { request_id: id } } });
    setBusy(null);
    if (data) {
      setItems((prev) => prev.map((r) => (r.id === id ? data : r)));
      refreshIncomingCount();
    } else {
      setActionProblem(error ?? null);
    }
  }

  // Запросы с заблокированными не показываются: блокировка их уже закрыла.
  const visible = items.filter((r) => !blocks.ids?.has(r.counterpart_id));

  if (problem) return <ErrorMessage problem={problem} />;
  if (loading && items.length === 0) return <Loading />;
  if (visible.length === 0 && !next) {
    return direction === 'incoming' ? (
      <EmptyState icon="📭" title="Входящих запросов пока нет">
        <p className="muted">Когда кто-то захочет обменяться с вами контактами, запрос появится здесь.</p>
      </EmptyState>
    ) : (
      <EmptyState icon="✉️" title="Вы ещё никому не писали">
        <p className="muted">Найдите подходящего человека и запросите контакт на странице его анкеты.</p>
        <Link href="/candidates" className="btn btn-primary">
          Смотреть кандидатов
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {actionProblem && (
        <div className="alert" role="alert">
          <p>{problemMessage(actionProblem)}</p>
          {actionProblem.code === 'contact_required' && <Link href="/contact">Указать контакт →</Link>}
        </div>
      )}
      {visible.map((r) => {
        const card = cards[r.counterpart_id];
        const chip = statusChips[r.status];
        const contact = r.status === 'accepted' ? r.counterpart_contact : undefined;
        const city = card ? cityName(cities.data, card.city_id) : undefined;
        return (
          <article key={r.id} className="panel request">
            <Avatar id={r.counterpart_id} name={card?.display_name ?? '?'} size="m" />
            <div className="stack stack-tight">
              <div className="row">
                {card ? (
                  <Link href={`/candidates/${r.counterpart_id}`} className="tile-title">
                    {candidateTitle(card)}
                  </Link>
                ) : (
                  <span className="muted">Анкета недоступна</span>
                )}
                <span className={`chip ${chip.tone}`}>{chip.text}</span>
              </div>
              {card && (
                <>
                  <span className="small">
                    <strong>{formatBudget(card.budget_min_rub, card.budget_max_rub)}</strong>
                    {city ? ` · ${city}` : ''} · {card.occupation}
                  </span>
                  <span>
                    <MatchChip card={card} />
                  </span>
                </>
              )}
              <span className="small muted">
                {direction === 'incoming' ? 'Получен' : 'Отправлен'} {formatDate(r.created_at)}
              </span>
            </div>
            <div className="request-actions">
              {contact && (
                <a
                  className="contact-link"
                  href={contactUrl(contact)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {contactLabel(contact)}
                </a>
              )}
              {contact && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setOpenAgreement(openAgreement === r.id ? null : r.id)}
                >
                  {openAgreement === r.id ? 'Скрыть договорённости' : 'Договорённости'}
                </button>
              )}
              {r.status === 'pending' && direction === 'incoming' && (
                <>
                  <button
                    type="button"
                    className="btn btn-accent"
                    disabled={busy === r.id}
                    onClick={() => void answer(r.id, 'accept')}
                  >
                    Принять и обменяться
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === r.id}
                    onClick={() => void answer(r.id, 'decline')}
                  >
                    Отклонить
                  </button>
                </>
              )}
            </div>
            {openAgreement === r.id && (
              <div className="request-extra">
                <AgreementEditor requestId={r.id} />
              </div>
            )}
          </article>
        );
      })}
      {next && (
        <div className="center">
          <button type="button" className="btn" disabled={loading} onClick={() => void load(next)}>
            {loading ? 'Загружаем…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Заблокированные: здесь блокировку можно снять, не открывая анкету. */
function BlockedList() {
  const api = useApi();
  const blocks = useBlocks();
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const ids = blocks.ids ? [...blocks.ids] : [];
  const key = ids.join(',');

  useEffect(() => {
    if (!key) return;
    api.matching
      .POST('/v1/candidates/lookup', { body: { user_ids: key.split(',').slice(0, 50) } })
      .then(({ data }) => setCards(Object.fromEntries((data?.items ?? []).map((c) => [c.user_id, c]))));
  }, [api, key]);

  async function unblock(id: string) {
    setBusy(id);
    setProblem(null);
    const { response, error } = await api.interaction.DELETE('/v1/blocks/{user_id}', {
      params: { path: { user_id: id } },
    });
    setBusy(null);
    if (response.ok) await blocks.reload();
    else setProblem(error ?? null);
  }

  if (ids.length === 0) return null;
  return (
    <section className="mt-24">
      <h2 className="mb-12">Заблокированные</h2>
      {problem && (
        <div className="alert" role="alert">
          <p>{problemMessage(problem)}</p>
        </div>
      )}
      <div className="stack">
        {ids.map((id) => {
          const card = cards[id];
          return (
            <article key={id} className="panel request">
              <Avatar id={id} name={card?.display_name ?? '?'} size="m" />
              <span>{card ? candidateTitle(card) : <span className="muted">Анкета недоступна</span>}</span>
              <div className="request-actions">
                <button type="button" className="btn" disabled={busy === id} onClick={() => void unblock(id)}>
                  Разблокировать
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RequestsScreen() {
  const [direction, setDirection] = useState<Direction>('incoming');
  const incoming = useIncomingCount();
  return (
    <>
      <div className="page-head">
        <h1>Запросы на контакт</h1>
      </div>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'incoming'}
          onClick={() => setDirection('incoming')}
        >
          Входящие {incoming > 0 && <span className="counter">{incoming}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'outgoing'}
          onClick={() => setDirection('outgoing')}
        >
          Исходящие
        </button>
      </div>
      <RequestsList key={direction} direction={direction} />
      <BlockedList />
    </>
  );
}

export default function RequestsPage() {
  return (
    <main className="page page-narrow">
      <RequireAuth>
        <RequestsScreen />
      </RequireAuth>
    </main>
  );
}
