import type { InteractionSchemas, Problem } from '@sozhiteli/api-client';
import { fieldErrors } from '@sozhiteli/api-client';
import { useEffect, useState } from 'react';

import { Button, Choice, ErrorBox, Field, Loading, Note, Panel, Screen } from '@/components/ui';
import { useApi } from '@/lib/api';

type Kind = InteractionSchemas['Contact']['kind'];

const hints: Record<Kind, string> = {
  telegram: 'Имя пользователя без @, например ivan_petrov',
  vk: 'Короткое имя или id страницы, например ivan.petrov или id12345',
};

export default function ContactScreen() {
  const api = useApi();
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<Kind>('telegram');
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

  async function save() {
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

  return (
    <Screen>
      <Panel title="Контакт для связи">
        <Note>
          🔒 Контакт увидит только тот, с кем вы взаимно согласились обменяться контактами. Просмотр вашей
          анкеты его не раскрывает.
        </Note>
        <Choice
          label="Как с вами связаться"
          options={[
            ['telegram', 'Telegram'],
            ['vk', 'ВКонтакте'],
          ]}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setSaved(false);
          }}
        />
        <Field
          label={kind === 'telegram' ? 'Имя пользователя' : 'Страница'}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setSaved(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={64}
          hint={hints[kind]}
          error={valueError}
        />
      </Panel>
      {problem && !valueError && <ErrorBox problem={problem} />}
      {saved && <Note kind="ok">Контакт сохранён.</Note>}
      <Button
        primary
        title={saving ? 'Сохраняем…' : 'Сохранить контакт'}
        disabled={saving || value.trim().length < 2}
        onPress={() => void save()}
      />
    </Screen>
  );
}
