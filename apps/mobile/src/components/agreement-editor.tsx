/**
 * Договорённости пары после обмена контактами. Повторяет
 * apps/web/src/components/agreement-editor.tsx.
 */
import {
  type InteractionSchemas,
  type Problem,
  agreementTopics,
  appendToAgreement,
  formatDate,
} from '@sozhiteli/api-client';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { SharesCalculator } from '@/components/shares-calculator';
import { Button, ErrorBox, Field, Loading, Note, T } from '@/components/ui';
import { useApi } from '@/lib/api';

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

  useEffect(() => {
    let cancelled = false;
    api.interaction
      .GET('/v1/contact-requests/{request_id}/agreement', { params: { path: { request_id: requestId } } })
      .then(({ data, error }) => {
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
  }, [api, requestId]);

  async function save() {
    if (!items) return;
    setSaving(true);
    setProblem(null);
    const { data, error } = await api.interaction.PUT('/v1/contact-requests/{request_id}/agreement', {
      params: { path: { request_id: requestId } },
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

  if (problem && !items) return <ErrorBox problem={problem} />;
  if (!items) return <Loading />;

  return (
    <View style={{ gap: 10 }}>
      <T muted size={13}>
        Запишите, о чём договорились до заселения, — это увидите вы оба.
        {updated.at ? ` Изменено ${formatDate(updated.at)}${updated.byMe ? ' вами' : ' собеседником'}.` : ''}
      </T>
      {agreementTopics.map((topic) => (
        <View key={topic.code} style={{ gap: 8 }}>
          <Field
            label={topic.label}
            placeholder={topic.hint}
            value={items[topic.code] ?? ''}
            maxLength={TOPIC_MAX_LENGTH}
            multiline
            onChangeText={(v) => {
              setSaved(false);
              setItems({ ...items, [topic.code]: v });
            }}
          />
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
        </View>
      ))}
      {problem && <ErrorBox problem={problem} />}
      {saved && <Note kind="ok">Сохранено</Note>}
      <Button
        primary
        title={saving ? 'Сохраняем…' : 'Сохранить договорённости'}
        disabled={saving}
        onPress={() => void save()}
      />
    </View>
  );
}
