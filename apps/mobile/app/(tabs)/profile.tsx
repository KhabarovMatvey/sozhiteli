import type { Problem, ProfileSchemas } from '@sozhiteli/api-client';
import { fieldErrors, normalizeForSearch } from '@sozhiteli/api-client';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Button,
  Choice,
  ErrorBox,
  Field,
  Chip,
  Loading,
  Note,
  Panel,
  Screen,
  T,
  useTheme,
} from '@/components/ui';
import { useApi } from '@/lib/api';
import { useCities, useQuestionnaire, type City, type Questionnaire } from '@/lib/reference';

type Profile = ProfileSchemas['Profile'];
type ProfileInput = ProfileSchemas['ProfileInput'];

/** Даты вводятся как ДД.ММ.ГГГГ: без отдельной библиотеки выбора даты. */
function toIso(ru: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(ru.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

function fromIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

interface Draft {
  display_name: string;
  birth_year: string;
  gender: ProfileInput['gender'] | '';
  occupation: string;
  city_id: number | null;
  districts: string;
  budget_min_rub: string;
  budget_max_rub: string;
  move_in_from: string;
  move_in_to: string;
  roommate_gender: ProfileInput['roommate_gender'];
  habits: Record<string, string>;
  search_status: ProfileInput['search_status'];
}

function draftFrom(p: Profile | null): Draft {
  if (!p) {
    return {
      display_name: '',
      birth_year: '',
      gender: '',
      occupation: '',
      city_id: null,
      districts: '',
      budget_min_rub: '',
      budget_max_rub: '',
      move_in_from: '',
      move_in_to: '',
      roommate_gender: 'any',
      habits: {},
      search_status: 'searching',
    };
  }
  return {
    display_name: p.display_name,
    birth_year: String(p.birth_year),
    gender: p.gender,
    occupation: p.occupation,
    city_id: p.city_id,
    districts: p.districts,
    budget_min_rub: String(p.budget_min_rub),
    budget_max_rub: String(p.budget_max_rub),
    move_in_from: fromIso(p.move_in_from),
    move_in_to: fromIso(p.move_in_to),
    roommate_gender: p.roommate_gender,
    habits: p.habits,
    search_status: p.search_status,
  };
}

function CityPicker({
  cities,
  value,
  onChange,
  error,
}: {
  cities: City[];
  value: number | null;
  onChange: (id: number) => void;
  error?: string;
}) {
  const t = useTheme();
  const selected = cities.find((c) => c.id === value);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(!selected);

  const suggestions = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return [];
    const starts = cities.filter((c) => normalizeForSearch(c.name).startsWith(q));
    const contains = cities.filter(
      (c) => !normalizeForSearch(c.name).startsWith(q) && normalizeForSearch(c.name).includes(q),
    );
    return [...starts, ...contains].slice(0, 8);
  }, [cities, query]);

  const label = (c: City) => (c.region === c.name ? c.name : `${c.name}, ${c.region}`);

  if (selected && !editing) {
    return (
      <View style={{ gap: 8 }}>
        <T bold>Город</T>
        <Chip tone="info">📍 {label(selected)}</Chip>
        <Button title="Изменить город" onPress={() => setEditing(true)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Field
        label="Город"
        placeholder="Начните вводить название"
        value={query}
        onChangeText={setQuery}
        error={error}
      />
      {suggestions.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          onPress={() => {
            onChange(c.id);
            setQuery('');
            setEditing(false);
          }}
          style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line }}
        >
          <T>{label(c)}</T>
        </Pressable>
      ))}
      {query.length > 0 && suggestions.length === 0 && <T muted>Такого города нет в списке.</T>}
    </View>
  );
}

function ProfileForm({
  initial,
  questionnaire,
  cities,
}: {
  initial: Profile | null;
  questionnaire: Questionnaire;
  cities: City[];
}) {
  const api = useApi();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const errors = { ...fieldErrors(problem), ...localErrors };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  async function save() {
    const from = toIso(draft.move_in_from);
    const to = toIso(draft.move_in_to);
    const local: Record<string, string> = {};
    if (!from) local.move_in_from = 'Дата в формате ДД.ММ.ГГГГ.';
    if (!to) local.move_in_to = 'Дата в формате ДД.ММ.ГГГГ.';
    if (draft.gender === '') local.gender = 'Выберите пол.';
    if (draft.city_id === null) local.city_id = 'Выберите город из списка.';
    for (const q of questionnaire.questions) {
      if (!draft.habits[q.code]) local[`habits.${q.code}`] = 'Ответьте на вопрос.';
    }
    setLocalErrors(local);
    setProblem(null);
    if (Object.keys(local).length > 0 || !from || !to || draft.gender === '' || draft.city_id === null)
      return;

    setSaving(true);
    const { data, error } = await api.profile.PUT('/v1/me/profile', {
      body: {
        display_name: draft.display_name.trim(),
        birth_year: Number(draft.birth_year),
        gender: draft.gender,
        occupation: draft.occupation.trim(),
        city_id: draft.city_id,
        districts: draft.districts.trim(),
        budget_min_rub: Number(draft.budget_min_rub),
        budget_max_rub: Number(draft.budget_max_rub),
        move_in_from: from,
        move_in_to: to,
        roommate_gender: draft.roommate_gender,
        questionnaire_version: questionnaire.version,
        habits: draft.habits,
        search_status: draft.search_status,
      },
    });
    setSaving(false);
    if (data) setSaved(true);
    else setProblem(error ?? null);
  }

  const answered = questionnaire.questions.filter((q) => draft.habits[q.code]).length;

  return (
    <>
      <Panel title="О себе">
        <Field
          label="Имя"
          value={draft.display_name}
          onChangeText={(v) => set('display_name', v)}
          maxLength={40}
          error={errors.display_name}
        />
        <Field
          label="Год рождения"
          value={draft.birth_year}
          onChangeText={(v) => set('birth_year', v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={4}
          error={errors.birth_year}
        />
        <Choice
          label="Пол"
          options={[
            ['female', 'Женский'],
            ['male', 'Мужской'],
          ]}
          value={draft.gender}
          onChange={(v) => set('gender', v)}
          error={errors.gender}
        />
        <Field
          label="Учёба или работа"
          placeholder="Например: ЮУрГУ, 2 курс"
          value={draft.occupation}
          onChangeText={(v) => set('occupation', v)}
          maxLength={80}
          error={errors.occupation}
        />
      </Panel>

      <Panel title="Условия поиска">
        <CityPicker
          cities={cities}
          value={draft.city_id}
          onChange={(id) => set('city_id', id)}
          error={errors.city_id}
        />
        <Field
          label="Подходящие районы (необязательно)"
          value={draft.districts}
          onChangeText={(v) => set('districts', v)}
          maxLength={200}
          error={errors.districts}
        />
        <T muted size={13}>
          Бюджет — ваша доля аренды в месяц, без коммунальных платежей, ₽
        </T>
        <Field
          label="Бюджет от"
          value={draft.budget_min_rub}
          onChangeText={(v) => set('budget_min_rub', v.replace(/\D/g, ''))}
          keyboardType="number-pad"
        />
        <Field
          label="Бюджет до"
          value={draft.budget_max_rub}
          onChangeText={(v) => set('budget_max_rub', v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          error={errors.budget_max_rub ?? errors.budget_min_rub}
        />
        <Field
          label="Готов(а) заселиться с"
          placeholder="ДД.ММ.ГГГГ"
          value={draft.move_in_from}
          onChangeText={(v) => set('move_in_from', v)}
          keyboardType="numbers-and-punctuation"
          error={errors.move_in_from}
        />
        <Field
          label="по"
          placeholder="ДД.ММ.ГГГГ"
          value={draft.move_in_to}
          onChangeText={(v) => set('move_in_to', v)}
          keyboardType="numbers-and-punctuation"
          error={errors.move_in_to}
        />
        <Choice
          label="Сосед"
          options={[
            ['any', 'Пол не важен'],
            ['same', 'Только того же пола'],
          ]}
          value={draft.roommate_gender}
          onChange={(v) => set('roommate_gender', v)}
        />
      </Panel>

      <Panel
        title="Бытовые привычки"
        right={
          <Chip tone={answered === questionnaire.questions.length ? 'good' : 'info'}>
            {answered} из {questionnaire.questions.length}
          </Chip>
        }
      >
        <T muted size={13}>
          Ответы увидят другие участники рядом со своими: так проще заранее понять, где вы совпадаете.
        </T>
        {questionnaire.questions.map((q) => (
          <Choice
            key={q.code}
            label={q.title}
            options={q.options.map((o) => [o.code, o.label] as const)}
            value={draft.habits[q.code]}
            onChange={(v) => set('habits', { ...draft.habits, [q.code]: v })}
            error={errors[`habits.${q.code}`]}
          />
        ))}
      </Panel>

      <Panel title="Показывать анкету">
        <Choice
          options={[
            ['searching', 'Да, ищу соседа'],
            ['paused', 'Нет, поиск на паузе'],
          ]}
          value={draft.search_status}
          onChange={(v) => set('search_status', v)}
        />
        <T muted size={13}>
          На паузе вашу анкету никто не видит, но вы по-прежнему можете смотреть кандидатов.
        </T>
      </Panel>

      {problem && <ErrorBox problem={problem} />}
      {Object.keys(localErrors).length > 0 && <Note>Проверьте отмеченные поля.</Note>}
      {saved && (
        <Note kind="ok">Анкета сохранена. В выдаче у других она появится через несколько секунд.</Note>
      )}
      <Button
        primary
        title={saving ? 'Сохраняем…' : 'Сохранить анкету'}
        disabled={saving}
        onPress={() => void save()}
      />
    </>
  );
}

export default function ProfileScreen() {
  const api = useApi();
  const questionnaire = useQuestionnaire();
  const cities = useCities();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.profile.GET('/v1/me/profile').then(({ data, error }) => {
      if (cancelled) return;
      if (data) setProfile(data);
      else if (error?.code === 'profile_not_found') setProfile(null);
      else setProblem(error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const loadError = problem ?? questionnaire.error ?? cities.error;
  if (loadError !== undefined && loadError !== null) {
    return (
      <Screen>
        <ErrorBox problem={loadError} />
      </Screen>
    );
  }
  if (profile === undefined || !questionnaire.data || !cities.data) return <Loading />;

  return (
    <Screen>
      {profile === null && (
        <Note>
          Заполните анкету — после этого вы увидите подходящих соседей, а они вас. Это займёт пару минут.
        </Note>
      )}
      <ProfileForm initial={profile} questionnaire={questionnaire.data} cities={cities.data} />
    </Screen>
  );
}
