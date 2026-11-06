'use client';

import { type Problem, type ProfileSchemas, fieldErrors, networkProblem } from '@sozhiteli/api-client';
import { useState, type FormEvent, type ReactNode } from 'react';

import type { City, Questionnaire } from '@/lib/reference';

import { CityPicker } from './city-picker';
import { ErrorMessage } from './states';

type Profile = ProfileSchemas['Profile'];
type ProfileInput = ProfileSchemas['ProfileInput'];

/**
 * Сохраняет анкету. Своя анкета уходит на /v1/me/profile, анкета пользователя
 * в админке - на /v1/admin/users/{id}/profile; сама форма от этого не зависит.
 */
export type SaveProfile = (body: ProfileInput) => Promise<{ data?: Profile; error?: Problem }>;

/** Значения полей формы; числа хранятся строками, пока пользователь их вводит. */
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

function draftFrom(profile: Profile | null): Draft {
  if (!profile) {
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
    display_name: profile.display_name,
    birth_year: String(profile.birth_year),
    gender: profile.gender,
    occupation: profile.occupation,
    city_id: profile.city_id,
    districts: profile.districts,
    budget_min_rub: String(profile.budget_min_rub),
    budget_max_rub: String(profile.budget_max_rub),
    move_in_from: profile.move_in_from,
    move_in_to: profile.move_in_to,
    roommate_gender: profile.roommate_gender,
    habits: profile.habits,
    search_status: profile.search_status,
  };
}

function FieldError({ text }: { text?: string }) {
  return text ? <p className="field-error">{text}</p> : null;
}

/** Выбор одного варианта плашками. */
function Segmented<V extends string>({
  name,
  options,
  value,
  onChange,
  required,
}: {
  name: string;
  options: readonly (readonly [V, string])[];
  value: string;
  onChange: (v: V) => void;
  required?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <label key={v}>
          <input
            type="radio"
            name={name}
            required={required}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

export function ProfileForm({
  initial,
  questionnaire,
  cities,
  save,
  onSaved,
  successMessage = 'Анкета сохранена.',
}: {
  initial: Profile | null;
  questionnaire: Questionnaire;
  cities: City[];
  save: SaveProfile;
  onSaved: (profile: Profile) => void;
  successMessage?: ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const errors = fieldErrors(problem);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const answered = questionnaire.questions.filter((q) => draft.habits[q.code]).length;
  const missingChoice = draft.gender === '' || draft.city_id === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.gender === '' || draft.city_id === null) return;
    setSaving(true);
    setProblem(null);
    const body: ProfileInput = {
      display_name: draft.display_name,
      birth_year: Number(draft.birth_year),
      gender: draft.gender,
      occupation: draft.occupation,
      city_id: draft.city_id,
      districts: draft.districts,
      budget_min_rub: Number(draft.budget_min_rub),
      budget_max_rub: Number(draft.budget_max_rub),
      move_in_from: draft.move_in_from,
      move_in_to: draft.move_in_to,
      roommate_gender: draft.roommate_gender,
      questionnaire_version: questionnaire.version,
      habits: draft.habits,
      search_status: draft.search_status,
    };
    let result: Awaited<ReturnType<SaveProfile>>;
    try {
      result = await save(body);
    } catch {
      result = { error: networkProblem };
    }
    const { data, error } = result;
    setSaving(false);
    if (data) {
      setSaved(true);
      onSaved(data);
    } else {
      setProblem(error ?? null);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <section className="panel form-section">
        <h2>О себе</h2>
        <div className="two-cols">
          <div className="field">
            <label className="label" htmlFor="display_name">
              Имя
            </label>
            <input
              id="display_name"
              required
              minLength={2}
              maxLength={40}
              placeholder="Как к вам обращаться"
              value={draft.display_name}
              onChange={(e) => set('display_name', e.target.value)}
              aria-invalid={errors.display_name ? true : undefined}
            />
            <FieldError text={errors.display_name} />
          </div>
          <div className="field">
            <label className="label" htmlFor="birth_year">
              Год рождения
            </label>
            <input
              id="birth_year"
              type="number"
              required
              min={1930}
              max={2100}
              placeholder="Например, 2006"
              value={draft.birth_year}
              onChange={(e) => set('birth_year', e.target.value)}
              aria-invalid={errors.birth_year ? true : undefined}
            />
            <FieldError text={errors.birth_year} />
          </div>
        </div>
        <div className="field">
          <span className="label">Пол</span>
          <Segmented
            name="gender"
            required
            options={[
              ['female', 'Женский'],
              ['male', 'Мужской'],
            ]}
            value={draft.gender}
            onChange={(v) => set('gender', v)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="occupation">
            Учёба или работа
          </label>
          <input
            id="occupation"
            required
            minLength={2}
            maxLength={80}
            placeholder="Например: ЮУрГУ, 2 курс"
            value={draft.occupation}
            onChange={(e) => set('occupation', e.target.value)}
            aria-invalid={errors.occupation ? true : undefined}
          />
          <FieldError text={errors.occupation} />
        </div>
      </section>

      <section className="panel form-section">
        <h2>Условия поиска</h2>
        <p className="hint">По ним вы увидите только подходящих людей — и они вас.</p>
        <CityPicker
          cities={cities}
          value={draft.city_id}
          onChange={(id) => set('city_id', id)}
          error={errors.city_id}
        />
        <div className="field">
          <label className="label" htmlFor="districts">
            Подходящие районы <span className="muted">— необязательно</span>
          </label>
          <input
            id="districts"
            maxLength={200}
            placeholder="Например: центр, рядом с университетом"
            value={draft.districts}
            onChange={(e) => set('districts', e.target.value)}
            aria-invalid={errors.districts ? true : undefined}
          />
          <FieldError text={errors.districts} />
        </div>
        <div className="field">
          <span className="label">Бюджет, ₽ в месяц</span>
          <span className="hint">Ваша доля аренды, без коммунальных платежей</span>
          <div className="two-cols">
            <input
              aria-label="Бюджет от"
              type="number"
              required
              min={0}
              max={1000000}
              step={500}
              placeholder="от"
              value={draft.budget_min_rub}
              onChange={(e) => set('budget_min_rub', e.target.value)}
            />
            <input
              aria-label="Бюджет до"
              type="number"
              required
              min={0}
              max={1000000}
              step={500}
              placeholder="до"
              value={draft.budget_max_rub}
              onChange={(e) => set('budget_max_rub', e.target.value)}
              aria-invalid={errors.budget_max_rub ? true : undefined}
            />
          </div>
          <FieldError text={errors.budget_max_rub ?? errors.budget_min_rub} />
        </div>
        <div className="field">
          <span className="label">Когда готовы заселиться</span>
          <div className="two-cols">
            <input
              aria-label="Заселение с"
              type="date"
              required
              value={draft.move_in_from}
              onChange={(e) => set('move_in_from', e.target.value)}
            />
            <input
              aria-label="Заселение по"
              type="date"
              required
              value={draft.move_in_to}
              onChange={(e) => set('move_in_to', e.target.value)}
              aria-invalid={errors.move_in_to ? true : undefined}
            />
          </div>
          <FieldError text={errors.move_in_to ?? errors.move_in_from} />
        </div>
        <div className="field">
          <span className="label">Сосед</span>
          <Segmented
            name="roommate_gender"
            options={[
              ['any', 'Пол не важен'],
              ['same', 'Только того же пола'],
            ]}
            value={draft.roommate_gender}
            onChange={(v) => set('roommate_gender', v)}
          />
        </div>
      </section>

      <section className="panel form-section">
        <div className="page-head mb-0">
          <h2>Бытовые привычки</h2>
          <span className={`chip ${answered === questionnaire.questions.length ? 'chip-good' : 'chip-info'}`}>
            Отвечено {answered} из {questionnaire.questions.length}
          </span>
        </div>
        <p className="hint">
          Ваши ответы увидят рядом со своими — так сразу понятно, где вы совпадаете, а о чём договориться.
        </p>
        {questionnaire.questions.map((q) => (
          <div key={q.code} className="field">
            <span className="label">{q.title}</span>
            <Segmented
              name={`habit-${q.code}`}
              required
              options={q.options.map((o) => [o.code, o.label] as const)}
              value={draft.habits[q.code] ?? ''}
              onChange={(v) => set('habits', { ...draft.habits, [q.code]: v })}
            />
            <FieldError text={errors[`habits.${q.code}`]} />
          </div>
        ))}
      </section>

      <section className="panel form-section">
        <h2>Показывать анкету</h2>
        <Segmented
          name="search_status"
          options={[
            ['searching', 'Да, ищу соседа'],
            ['paused', 'Нет, поиск на паузе'],
          ]}
          value={draft.search_status}
          onChange={(v) => set('search_status', v)}
        />
        <p className="hint">
          На паузе вашу анкету никто не видит, но вы по-прежнему можете смотреть кандидатов.
        </p>
      </section>

      {problem && <ErrorMessage problem={problem} />}
      {saved && (
        <div className="success" role="status">
          {successMessage}
        </div>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary btn-lg" disabled={saving || missingChoice}>
          {saving ? 'Сохраняем…' : 'Сохранить анкету'}
        </button>
        {missingChoice && <span className="hint">Выберите пол и город, чтобы сохранить анкету.</span>}
      </div>
    </form>
  );
}
