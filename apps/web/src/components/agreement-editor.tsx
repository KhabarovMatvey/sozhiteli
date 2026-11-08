'use client';

/**
 * Договорённости пары после обмена контактами: что решили про уборку, гостей,
 * шум, платежи и въезд. Видят и правят оба участника; хранится в Interaction.
 */
import {
  type InteractionSchemas,
  type Problem,
  agreementTopics,
  appendToAgreement,
  formatDate,
  problemMessage,
} from '@sozhiteli/api-client';
import { type FormEvent, useEffect, useState } from 'react';

import { useApi } from '@/lib/api';

import { SharesCalculator } from './shares-calculator';
import { Loading } from './states';

type Items = InteractionSchemas['AgreementItems'];

/** Лимит одной темы договорённости (maxLength в контракте Interaction). */
const TOPIC_MAX_LENGTH = 300;

export function AgreementEditor({ requestId }: { requestId: string }) {
  const api = useApi();
  const [items, setItems] = useState<Items | null>(null);
  const [updated, setUpdated] = useState<{ at?: string; byMe?: boolean }>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const params = { params: { path: { request_id: requestId } } };

  useEffect(() => {
    let cancelled = false;
    api.interaction.GET('/v1/contact-requests/{request_id}/agreement', params).then(({ data, error }) => {
      if (cancelled) return;
      if (data) {
        setItems(data.items);
        setUpdated({ at: data.updated_at, byMe: data.updated_by_me });
      } else {
        setProblem(error ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
    // params зависит только от requestId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, requestId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!items) return;
    setSaving(true);
    setProblem(null);
    const { data, error } = await api.interaction.PUT('/v1/contact-requests/{request_id}/agreement', {
      ...params,
      body: { items },
    });
    setSaving(false);
    if (data) {
      setItems(data.items);
      setUpdated({ at: data.updated_at, byMe: data.updated_by_me });
      setSaved(true);
    } else {
      setProblem(error ?? null);
    }
  }

  if (problem && !items) return <p className="muted small">{problemMessage(problem)}</p>;
  if (!items) return <Loading />;

  return (
    <form className="stack stack-tight agreement" onSubmit={(e) => void save(e)}>
      <p className="small muted">
        Запишите, о чём договорились до заселения, — это увидите вы оба.
        {updated.at && ` Изменено ${formatDate(updated.at)}${updated.byMe ? ' вами' : ' собеседником'}.`}
      </p>
      {agreementTopics.map((topic) => (
        <div key={topic.code} className="stack stack-tight">
          <label className="field">
            <span className="label small">{topic.label}</span>
            <textarea
              className="input"
              rows={topic.code === 'payments' ? 3 : 2}
              maxLength={TOPIC_MAX_LENGTH}
              placeholder={topic.hint}
              value={items[topic.code] ?? ''}
              onChange={(e) => {
                setSaved(false);
                setItems({ ...items, [topic.code]: e.target.value });
              }}
            />
          </label>
          {topic.code === 'payments' && (
            <SharesCalculator
              onInsert={(text) => {
                const next = appendToAgreement(items.payments, text, TOPIC_MAX_LENGTH);
                if (next === null) return false;
                setSaved(false);
                setItems({ ...items, payments: next });
                return true;
              }}
            />
          )}
        </div>
      ))}
      {problem && (
        <div className="alert" role="alert">
          <p>{problemMessage(problem)}</p>
        </div>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить договорённости'}
        </button>
        {saved && <span className="success small">Сохранено</span>}
      </div>
    </form>
  );
}
