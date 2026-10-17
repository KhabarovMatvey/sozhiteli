'use client';

import {
  type InteractionSchemas,
  type MatchingSchemas,
  type Problem,
  contactLabel,
  contactUrl,
  formatBudget,
  optionLabel,
  problemMessage,
  questionTitle,
} from '@sozhiteli/api-client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Avatar } from '@/components/avatar';
import { CandidateSpecs, MatchChip, candidateTitle } from '@/components/candidate-summary';
import { RequireAuth } from '@/components/require-auth';
import { ErrorMessage, Loading } from '@/components/states';
import { useApi } from '@/lib/api';
import { useCities, useQuestionnaire } from '@/lib/reference';

type Detail = MatchingSchemas['CandidateDetail'];
type Habit = MatchingSchemas['HabitComparison'];
type ContactRequest = InteractionSchemas['ContactRequest'];

const conditionLabels: [keyof Detail['conditions'], string][] = [
  ['same_city', 'Один город'],
  ['budget_overlap', 'Бюджеты пересекаются'],
  ['move_in_overlap', 'Сроки заселения пересекаются'],
  ['roommate_gender_ok', 'Подходит по полу соседа'],
];

const resultOrder: Habit['result'][] = ['difference', 'match', 'not_comparable'];

function Mark({ result }: { result: Habit['result'] }) {
  if (result === 'match')
    return (
      <span className="mark mark-yes" title="Совпадает">
        ✓
      </span>
    );
  if (result === 'difference')
    return (
      <span className="mark mark-no" title="Различается">
        ≠
      </span>
    );
  return (
    <span className="mark mark-none" title="Не с чем сравнить">
      ?
    </span>
  );
}

/** Состояние обмена контактами и кнопка запроса - правая панель. */
function ContactPanel({ detail }: { detail: Detail }) {
  const api = useApi();
  const userId = detail.card.user_id;
  const [request, setRequest] = useState<ContactRequest | null | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      (['outgoing', 'incoming'] as const).map((direction) =>
        api.interaction.GET('/v1/contact-requests', {
          params: { query: { direction, counterpart_id: userId, limit: 1 } },
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const failed = results.find((r) => !r.data);
      if (failed) setProblem(failed.error ?? null);
      else setRequest(results.flatMap((r) => r.data?.items ?? [])[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  async function send() {
    setSending(true);
    setProblem(null);
    const { data, error } = await api.interaction.POST('/v1/contact-requests', {
      body: { recipient_id: userId },
    });
    setSending(false);
    if (data) setRequest(data);
    else setProblem(error ?? null);
  }

  const contact = request?.status === 'accepted' ? request.counterpart_contact : undefined;

  return (
    <aside className="panel sticky stack">
      <div>
        <div className="price">{formatBudget(detail.card.budget_min_rub, detail.card.budget_max_rub)}</div>
        <p className="small muted">в месяц на человека, без коммунальных</p>
      </div>
      <MatchChip card={detail.card} />

      {request === undefined && !problem && <Loading />}
      {contact && (
        <>
          <p className="success">Вы обменялись контактами</p>
          <a className="contact-link" href={contactUrl(contact)} target="_blank" rel="noopener noreferrer">
            {contactLabel(contact)}
          </a>
        </>
      )}
      {request?.status === 'pending' && request.direction === 'outgoing' && (
        <p className="info">Запрос отправлен. Контакт появится здесь, когда кандидат его примет.</p>
      )}
      {request?.status === 'pending' && request.direction === 'incoming' && (
        <>
          <p className="info">Этот человек уже прислал вам запрос.</p>
          <Link href="/requests" className="btn btn-accent btn-block">
            Ответить на запрос
          </Link>
        </>
      )}
      {request?.status === 'declined' && <p className="muted">Запрос отклонён.</p>}
      {request === null && (
        <>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={sending}
            onClick={() => void send()}
          >
            {sending ? 'Отправляем…' : 'Запросить контакт'}
          </button>
          <p className="small muted">
            Кандидат увидит ваш контакт, только если примет запрос. Тогда и вы увидите его контакт.
          </p>
        </>
      )}
      {problem && (
        <div className="alert" role="alert">
          <p>{problemMessage(problem)}</p>
          {problem.code === 'contact_required' && <Link href="/contact">Указать контакт →</Link>}
        </div>
      )}
    </aside>
  );
}

function CandidateScreen({ userId }: { userId: string }) {
  const api = useApi();
  const questionnaire = useQuestionnaire();
  const cities = useCities();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.matching
      .GET('/v1/candidates/{user_id}', { params: { path: { user_id: userId } } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (data) setDetail(data);
        else setProblem(error ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  if (problem) return <ErrorMessage problem={problem} />;
  if (!detail) return <Loading />;

  const q = questionnaire.data;
  const habits = [...detail.habits].sort(
    (a, b) => resultOrder.indexOf(a.result) - resultOrder.indexOf(b.result),
  );
  const { matched_count: matched, compared_count: compared } = detail.card.compatibility;

  return (
    <div className="layout-detail">
      <div>
        <div className="page-head page-head-person">
          <Avatar id={detail.card.user_id} name={detail.card.display_name} size="l" />
          <div>
            <h1>{candidateTitle(detail.card)}</h1>
            <p className="muted">{detail.card.occupation}</p>
          </div>
        </div>

        <section className="panel">
          <h2 className="panel-title">Характеристики</h2>
          <CandidateSpecs card={detail.card} cities={cities.data} />
        </section>

        <section className="panel">
          <h2 className="panel-title">Обязательные условия</h2>
          <ul className="checklist">
            {conditionLabels.map(([key, label]) => (
              <li key={key}>
                <span className={`mark ${detail.conditions[key] ? 'mark-yes' : 'mark-no'}`}>
                  {detail.conditions[key] ? '✓' : '✗'}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="page-head mb-12">
            <h2>Бытовые привычки</h2>
            {compared > 0 && (
              <span className="muted">
                совпадает {matched} из {compared}
              </span>
            )}
          </div>
          {compared > 0 && (
            <meter
              className="meter mb-12"
              min={0}
              max={compared}
              value={matched}
              aria-label={`Совпадает ${matched} из ${compared}`}
            />
          )}
          <p className="small muted mb-8">Сначала — различия: о них стоит договориться заранее.</p>
          <div className="compare">
            <div className="compare-row compare-head">
              <span />
              <span>Вопрос</span>
              <span>Вы</span>
              <span>{detail.card.display_name}</span>
            </div>
            {habits.map((h) => (
              <div key={h.question_code} className="compare-row">
                <Mark result={h.result} />
                <span className="compare-question">{questionTitle(q, h.question_code)}</span>
                <span>{optionLabel(q, h.question_code, h.my_option)}</span>
                <span>{optionLabel(q, h.question_code, h.their_option)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <ContactPanel detail={detail} />
    </div>
  );
}

export default function CandidatePage() {
  const { userId } = useParams<{ userId: string }>();
  return (
    <main className="page">
      <p className="mb-16">
        <Link href="/candidates">← Все кандидаты</Link>
      </p>
      <RequireAuth>
        <CandidateScreen userId={userId} />
      </RequireAuth>
    </main>
  );
}
