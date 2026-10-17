import type { InteractionSchemas, MatchingSchemas, Problem } from '@sozhiteli/api-client';
import { contactLabel, contactUrl, formatBudget, optionLabel, questionTitle } from '@sozhiteli/api-client';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  CandidateFacts,
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

// Сначала различия: о них стоит договориться заранее (как на web).
const resultOrder: Record<Habit['result'], number> = { difference: 0, match: 1, not_comparable: 2 };

function Mark({ result }: { result: Habit['result'] | 'yes' | 'no' }) {
  const t = useTheme();
  const look = {
    match: ['✓', t.greenSoft, t.ok],
    yes: ['✓', t.greenSoft, t.ok],
    difference: ['≠', t.badSoft, t.bad],
    no: ['✗', t.badSoft, t.bad],
    not_comparable: ['–', t.soft, t.muted],
  }[result];
  return (
    <View style={[styles.mark, { backgroundColor: look[1] }]}>
      <Text style={{ color: look[2], fontWeight: '800' }}>{look[0]}</Text>
    </View>
  );
}

function ContactExchange({ detail }: { detail: Detail }) {
  const api = useApi();
  const t = useTheme();
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
    <Panel>
      <Text style={[styles.price, { color: t.text }]}>
        {formatBudget(detail.card.budget_min_rub, detail.card.budget_max_rub)}
      </Text>
      <T muted size={13}>
        в месяц на человека, без коммунальных
      </T>
      {request === undefined && !problem && <Loading />}
      {contact && (
        <Note kind="ok">
          <T bold>Вы обменялись контактами</T>
          <Text
            style={{ color: t.accent, fontSize: 16, fontWeight: '700' }}
            onPress={() => void Linking.openURL(contactUrl(contact))}
          >
            {contactLabel(contact)}
          </Text>
        </Note>
      )}
      {request?.status === 'pending' && request.direction === 'outgoing' && (
        <Note>Запрос отправлен. Контакт появится здесь, когда кандидат его примет.</Note>
      )}
      {request?.status === 'pending' && request.direction === 'incoming' && (
        <>
          <Note>Этот человек прислал вам запрос на обмен контактами.</Note>
          <Button primary title="Ответить в «Запросах»" onPress={() => router.navigate('/requests')} />
        </>
      )}
      {request?.status === 'declined' && <T muted>Запрос отклонён.</T>}
      {request === null && (
        <>
          <Button
            primary
            title={sending ? 'Отправляем…' : 'Запросить контакт'}
            disabled={sending}
            onPress={() => void send()}
          />
          <T muted size={13}>
            Кандидат увидит ваш контакт, только если примет запрос. Тогда и вы увидите его контакт.
          </T>
        </>
      )}
      {problem && (
        <ErrorBox problem={problem}>
          {problem.code === 'contact_required' && (
            <Button title="Указать контакт" onPress={() => router.navigate('/contact')} />
          )}
        </ErrorBox>
      )}
    </Panel>
  );
}

export default function CandidateScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const api = useApi();
  const questionnaire = useQuestionnaire();
  const cities = useCities();
  const t = useTheme();
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

  if (problem) {
    return (
      <Screen>
        <ErrorBox problem={problem} />
      </Screen>
    );
  }
  if (!detail) return <Loading />;

  const q = questionnaire.data;
  const habits = [...detail.habits].sort((a, b) => resultOrder[a.result] - resultOrder[b.result]);

  return (
    <Screen>
      <View style={styles.person}>
        <Avatar id={detail.card.user_id} name={detail.card.display_name} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <T bold size={22}>
            {candidateTitle(detail.card)}
          </T>
          <MatchChip card={detail.card} />
        </View>
      </View>

      <ContactExchange detail={detail} />

      <Panel title="Характеристики">
        <CandidateFacts card={detail.card} cities={cities.data} />
      </Panel>

      <Panel title="Обязательные условия">
        {conditionLabels.map(([key, label]) => (
          <View key={key} style={styles.line}>
            <Mark result={detail.conditions[key] ? 'yes' : 'no'} />
            <T>{label}</T>
          </View>
        ))}
      </Panel>

      <Panel title="Бытовые привычки">
        <T muted size={13}>
          Сначала — различия: о них стоит договориться заранее.
        </T>
        {habits.map((h) => (
          <View key={h.question_code} style={[styles.habit, { borderColor: t.line }]}>
            <View style={styles.line}>
              <Mark result={h.result} />
              <View style={{ flex: 1 }}>
                <T bold>{questionTitle(q, h.question_code)}</T>
              </View>
            </View>
            <View style={styles.answers}>
              <T muted size={13}>
                Вы: <T size={13}>{optionLabel(q, h.question_code, h.my_option)}</T>
              </T>
              <T muted size={13}>
                {detail.card.display_name}: <T size={13}>{optionLabel(q, h.question_code, h.their_option)}</T>
              </T>
            </View>
          </View>
        ))}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  price: { fontSize: 26, fontWeight: '800' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  habit: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  answers: { paddingLeft: 36, gap: 2 },
});
