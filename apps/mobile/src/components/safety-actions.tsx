/**
 * Жалоба администратору и блокировка на карточке человека. Повторяет
 * apps/web/src/components/safety-actions.tsx.
 */
import { type InteractionSchemas, type Problem, reportReasons } from '@sozhiteli/api-client';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Choice, ErrorBox, Field, Note, Panel, T } from '@/components/ui';
import { useApi } from '@/lib/api';

type ReportReason = InteractionSchemas['ReportReason'];

const reasonOptions = reportReasons.map((r) => [r.code, r.label] as const);

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
  const [reason, setReason] = useState<ReportReason | ''>('');
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

  async function sendReport() {
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
    <Panel title="Безопасность">
      {problem && <ErrorBox problem={problem} />}
      {reported && <Note kind="ok">Жалоба отправлена. Администратор её рассмотрит.</Note>}

      {mode === 'report' && (
        <View style={{ gap: 12 }}>
          <Choice label="Что не так?" options={reasonOptions} value={reason} onChange={setReason} />
          <Field
            label={reason === 'other' ? 'Комментарий' : 'Комментарий (необязательно)'}
            value={comment}
            onChangeText={setComment}
            maxLength={500}
            multiline
          />
          <Button
            primary
            title={busy ? 'Отправляем…' : 'Отправить жалобу'}
            disabled={busy || !reason || commentMissing}
            onPress={() => void sendReport()}
          />
          <Button title="Отмена" onPress={() => setMode('idle')} />
        </View>
      )}

      {mode === 'confirm-block' && (
        <View style={{ gap: 12 }}>
          <T size={14}>
            Вы больше не сможете обмениваться запросами, а открытые контакты скроются у обоих. Человек не
            узнает о блокировке.
          </T>
          <Button
            primary
            title={busy ? 'Блокируем…' : 'Заблокировать'}
            disabled={busy}
            onPress={() => void setBlocked(true)}
          />
          <Button title="Отмена" onPress={() => setMode('idle')} />
        </View>
      )}

      {mode === 'idle' && (
        <View style={{ gap: 8 }}>
          {!reported && <Button title="Пожаловаться" onPress={() => setMode('report')} />}
          {blocked ? (
            <Button title="Разблокировать" disabled={busy} onPress={() => void setBlocked(false)} />
          ) : (
            <Button title="Заблокировать" onPress={() => setMode('confirm-block')} />
          )}
        </View>
      )}
    </Panel>
  );
}
