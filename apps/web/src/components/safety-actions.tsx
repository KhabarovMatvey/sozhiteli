'use client';

/**
 * Защита от нежелательных контактов на карточке человека: жалоба
 * администратору и блокировка. Блокировка запрещает запросы в обе стороны и
 * скрывает уже открытые контакты; жалобу рассматривают вручную.
 */
import { type InteractionSchemas, type Problem, problemMessage, reportReasons } from '@sozhiteli/api-client';
import { type FormEvent, useState } from 'react';

import { useApi } from '@/lib/api';

type ReportReason = InteractionSchemas['ReportReason'];

export function SafetyActions({
  userId,
  blocked,
  onBlockedChange,
}: {
  userId: string;
  blocked: boolean;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const api = useApi();
  const [mode, setMode] = useState<'idle' | 'report' | 'confirm-block'>('idle');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reported, setReported] = useState(false);

  async function setBlocked(next: boolean) {
    setBusy(true);
    setProblem(null);
    const params = { params: { path: { user_id: userId } } };
    const { error, response } = next
      ? await api.interaction.PUT('/v1/blocks/{user_id}', params)
      : await api.interaction.DELETE('/v1/blocks/{user_id}', params);
    setBusy(false);
    if (response.ok) {
      setMode('idle');
      onBlockedChange(next);
    } else {
      setProblem(error ?? null);
    }
  }

  async function sendReport(event: FormEvent) {
    event.preventDefault();
    if (!reason) return;
    setBusy(true);
    setProblem(null);
    const text = comment.trim();
    const { data, error } = await api.interaction.POST('/v1/reports', {
      body: { reported_id: userId, reason, ...(text ? { comment: text } : {}) },
    });
    setBusy(false);
    if (data || error?.code === 'report_exists') {
      setReported(true);
      setMode('idle');
    } else {
      setProblem(error ?? null);
    }
  }

  const commentMissing = reason === 'other' && comment.trim() === '';

  return (
    <div className="stack stack-tight safety">
      {problem && (
        <div className="alert" role="alert">
          <p>{problemMessage(problem)}</p>
        </div>
      )}
      {reported && <p className="success small">Жалоба отправлена. Администратор её рассмотрит.</p>}

      {mode === 'report' && (
        <form className="stack stack-tight" onSubmit={(e) => void sendReport(e)}>
          <fieldset className="radio-list">
            <legend className="label">Что не так?</legend>
            {reportReasons.map((r) => (
              <label key={r.code}>
                <input
                  type="radio"
                  name="reason"
                  value={r.code}
                  checked={reason === r.code}
                  onChange={() => setReason(r.code)}
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="label small">Комментарий{reason === 'other' ? '' : ' (необязательно)'}</span>
            <textarea
              className="input"
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy || !reason || commentMissing}>
              {busy ? 'Отправляем…' : 'Отправить жалобу'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {mode === 'confirm-block' && (
        <div className="stack stack-tight">
          <p className="small">
            Вы больше не сможете обмениваться запросами, а открытые контакты скроются у обоих. Человек не
            узнает о блокировке.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void setBlocked(true)}
            >
              {busy ? 'Блокируем…' : 'Заблокировать'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {mode === 'idle' && (
        <div className="row">
          {!reported && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setMode('report')}>
              Пожаловаться
            </button>
          )}
          {blocked ? (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={busy}
              onClick={() => void setBlocked(false)}
            >
              Разблокировать
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setMode('confirm-block')}
            >
              Заблокировать
            </button>
          )}
        </div>
      )}
    </div>
  );
}
