'use client';

import { type InteractionSchemas, type Problem, fieldErrors } from '@sozhiteli/api-client';
import { useEffect, useState, type FormEvent } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { ErrorMessage, Loading } from '@/components/states';
import { useApi } from '@/lib/api';

type Contact = InteractionSchemas['Contact'];

const kinds = [
  {
    kind: 'telegram' as const,
    title: 'Telegram',
    hint: 'Имя пользователя без @, например ivan_petrov',
    prefix: '@',
  },
  {
    kind: 'vk' as const,
    title: 'ВКонтакте',
    hint: 'Короткое имя или id страницы, например ivan.petrov',
    prefix: 'vk.com/',
  },
];

function ContactScreen() {
  const api = useApi();
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<Contact['kind']>('telegram');
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.interaction.GET('/v1/me/contact').then(({ data, error }) => {
      if (cancelled) return;
      if (data) {
        setKind(data.kind);
        setValue(data.value);
      } else if (error?.code !== 'contact_not_found') {
        setProblem(error ?? null);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const { data, error } = await api.interaction.PUT('/v1/me/contact', {
      body: { kind, value: value.trim() },
    });
    setSaving(false);
    if (data) setSaved(true);
    else setProblem(error ?? null);
  }

  if (!loaded) return <Loading />;
  const valueError = fieldErrors(problem).value;
  const current = kinds.find((k) => k.kind === kind)!;

  return (
    <>
      <div className="page-head">
        <h1>Контакт для связи</h1>
      </div>
      <form onSubmit={submit} className="stack">
        <section className="panel form-section">
          <p className="info">
            🔒 Контакт увидит только тот, с кем вы взаимно согласились обменяться контактами. Просмотр вашей
            анкеты его не раскрывает.
          </p>
          <div className="field">
            <span className="label">Где с вами связаться</span>
            <div className="segmented" role="radiogroup">
              {kinds.map((k) => (
                <label key={k.kind}>
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === k.kind}
                    onChange={() => {
                      setKind(k.kind);
                      setSaved(false);
                    }}
                  />
                  <span>{k.title}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="contact-value">
              {kind === 'telegram' ? 'Имя пользователя' : 'Адрес страницы'}
            </label>
            <div className="row row-nowrap">
              <span className="chip">{current.prefix}</span>
              <input
                id="contact-value"
                required
                minLength={2}
                maxLength={64}
                autoComplete="off"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setSaved(false);
                }}
                aria-invalid={valueError ? true : undefined}
              />
            </div>
            <span className="hint">{current.hint}</span>
            {valueError && <p className="field-error">{valueError}</p>}
          </div>
        </section>
        {problem && !valueError && <ErrorMessage problem={problem} />}
        {saved && (
          <p className="success" role="status">
            Контакт сохранён.
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить контакт'}
          </button>
        </div>
      </form>
    </>
  );
}

export default function ContactPage() {
  return (
    <main className="page page-narrow">
      <RequireAuth>
        <ContactScreen />
      </RequireAuth>
    </main>
  );
}
