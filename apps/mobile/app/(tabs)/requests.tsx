import type { InteractionSchemas, MatchingSchemas, Problem } from '@sozhiteli/api-client';
import { contactLabel, contactUrl, formatBudget, formatDate } from '@sozhiteli/api-client';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  Chip,
  type ChipTone,
  ErrorBox,
  Loading,
  MatchChip,
  Note,
  Panel,
  Screen,
  T,
  candidateTitle,
  useTheme,
} from '@/components/ui';
import { useApi } from '@/lib/api';
import { AgreementEditor } from '@/components/agreement-editor';
import { useBlocks } from '@/lib/blocks';

type Direction = InteractionSchemas['Direction'];
type ContactRequest = InteractionSchemas['ContactRequest'];
type Card = MatchingSchemas['CandidateCard'];

const statusChips: Record<ContactRequest['status'], [string, ChipTone]> = {
  pending: ['ждёт ответа', 'mid'],
  accepted: ['контакты открыты', 'good'],
  declined: ['отклонён', 'low'],
};

function RequestsList({ direction }: { direction: Direction }) {
  const api = useApi();
  const blocks = useBlocks();
  const [openAgreement, setOpenAgreement] = useState<string | null>(null);
  const t = useTheme();
  const [items, setItems] = useState<ContactRequest[]>([]);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [actionProblem, setActionProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    // Первая страница при открытии экрана.
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
    if (data) setItems((prev) => prev.map((r) => (r.id === id ? data : r)));
    else setActionProblem(error ?? null);
  }

  if (problem) return <ErrorBox problem={problem} />;
  if (loading && items.length === 0) return <Loading />;
  // Запросы с заблокированными не показываются: блокировка их уже закрыла.
  const visible = items.filter((r) => !blocks.ids?.has(r.counterpart_id));
  if (visible.length === 0 && !next) {
    return direction === 'incoming' ? (
      <Note kind="empty" icon="📭">
        <T bold size={18}>
          Входящих запросов пока нет
        </T>
        <T muted>Когда кто-то захочет обменяться с вами контактами, запрос появится здесь.</T>
      </Note>
    ) : (
      <>
        <Note kind="empty" icon="✉️">
          <T bold size={18}>
            Вы ещё никому не писали
          </T>
          <T muted>Найдите подходящего человека и запросите контакт на странице его анкеты.</T>
        </Note>
        <Button primary title="Смотреть кандидатов" onPress={() => router.navigate('/candidates')} />
      </>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {actionProblem && (
        <ErrorBox problem={actionProblem}>
          {actionProblem.code === 'contact_required' && (
            <Button title="Указать контакт" onPress={() => router.navigate('/contact')} />
          )}
        </ErrorBox>
      )}
      {visible.map((r) => {
        const card = cards[r.counterpart_id];
        const contact = r.status === 'accepted' ? r.counterpart_contact : undefined;
        const [statusText, statusTone] = statusChips[r.status];
        return (
          <Panel key={r.id}>
            <Pressable
              accessibilityRole="link"
              disabled={!card}
              onPress={() =>
                router.push({ pathname: '/candidate/[userId]', params: { userId: r.counterpart_id } })
              }
              style={styles.person}
            >
              <Avatar id={r.counterpart_id} name={card?.display_name ?? '?'} size={52} />
              <View style={{ flex: 1, gap: 4 }}>
                {card ? (
                  <T bold size={16} color={t.accent}>
                    {candidateTitle(card)}
                  </T>
                ) : (
                  <T muted>Анкета недоступна</T>
                )}
                {card && (
                  <T size={13}>
                    <T bold size={13}>
                      {formatBudget(card.budget_min_rub, card.budget_max_rub)}
                    </T>{' '}
                    · {card.occupation}
                  </T>
                )}
                <View style={styles.chips}>
                  <Chip tone={statusTone}>{statusText}</Chip>
                  {card && <MatchChip card={card} />}
                </View>
                <T muted size={13}>
                  {direction === 'incoming' ? 'Получен' : 'Отправлен'} {formatDate(r.created_at)}
                </T>
              </View>
            </Pressable>
            {contact && (
              <Note kind="ok">
                <Text
                  style={{ color: t.accent, fontSize: 16, fontWeight: '700' }}
                  onPress={() => void Linking.openURL(contactUrl(contact))}
                >
                  {contactLabel(contact)}
                </Text>
              </Note>
            )}
            {contact && (
              <Button
                title={openAgreement === r.id ? 'Скрыть договорённости' : 'Договорённости'}
                onPress={() => setOpenAgreement(openAgreement === r.id ? null : r.id)}
              />
            )}
            {openAgreement === r.id && <AgreementEditor requestId={r.id} />}
            {r.status === 'pending' && direction === 'incoming' && (
              <View style={{ gap: 8 }}>
                <Button
                  success
                  title="Принять и обменяться"
                  disabled={busy === r.id}
                  onPress={() => void answer(r.id, 'accept')}
                />
                <Button
                  title="Отклонить"
                  disabled={busy === r.id}
                  onPress={() => void answer(r.id, 'decline')}
                />
              </View>
            )}
          </Panel>
        );
      })}
      {next && (
        <Button
          title={loading ? 'Загрузка…' : 'Показать ещё'}
          disabled={loading}
          onPress={() => void load(next)}
        />
      )}
    </View>
  );
}

function Tabs({ value, onChange }: { value: Direction; onChange: (d: Direction) => void }) {
  const t = useTheme();
  const tabs: [Direction, string][] = [
    ['incoming', 'Входящие'],
    ['outgoing', 'Исходящие'],
  ];
  return (
    <View style={[styles.tabs, { backgroundColor: t.soft }]} accessibilityRole="tablist">
      {tabs.map(([d, title]) => {
        const selected = d === value;
        return (
          <Pressable
            key={d}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(d)}
            style={[styles.tab, selected && { backgroundColor: t.surface }]}
          >
            <Text style={{ color: selected ? t.text : t.muted, fontWeight: '700', fontSize: 15 }}>
              {title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RequestsScreen() {
  const [direction, setDirection] = useState<Direction>('incoming');
  return (
    <Screen>
      <Tabs value={direction} onChange={setDirection} />
      <RequestsList key={direction} direction={direction} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tabs: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
});
