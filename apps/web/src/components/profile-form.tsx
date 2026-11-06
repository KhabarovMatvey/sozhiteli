'use client';

import {
  type Problem,
  type ProfileSchemas,
  fieldErrors,
  formatRub,
  networkProblem,
} from '@sozhiteli/api-client';
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
  scenario: NonNullable<ProfileInput['scenario']>;
  accepts_room: boolean;
  utilities_rub: string;
  deposit_rub: string;
  place_note: string;
  required_habits: string[];
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
      scenario: 'pair',
      accepts_room: false,
      utilities_rub: '',
      deposit_rub: '',
      place_note: '',
      required_habits: [],
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
    scenario: profile.scenario,
    accepts_room: profile.accepts_room,
    utilities_rub: profile.utilities_rub === undefined ? '' : String(profile.utilities_rub),
    deposit_rub: profile.deposit_rub === undefined ? '' : String(profile.deposit_rub),
    place_note: profile.place_note,
    required_habits: profile.required_habits,
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
  const offer = draft.scenario === 'room_offer';
  const rent = Number(draft.budget_min_rub);
  const deposit = Number(draft.deposit_rub);
  const utilities = Number(draft.utilities_rub);
  const toggleRequired = (code: string) =>
    set(
      'required_habits',
      draft.required_habits.includes(code)
        ? draft.required_habits.filter((c) => c !== code)
        : [...draft.required_habits, code],
    );
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
      // У свободного места одна цена: аренда за место.
      budget_max_rub: Number(offer ? draft.budget_min_rub : draft.budget_max_rub),
      move_in_from: draft.move_in_from,
      move_in_to: draft.move_in_to,
      roommate_gender: draft.roommate_gender,
      questionnaire_version: questionnaire.version,
      habits: draft.habits,
      search_status: draft.search_status,
      scenario: draft.scenario,
      accepts_room: !offer && draft.accepts_room,
      required_habits: draft.required_habits.filter((code) =>
        questionnaire.questions.some((q) => q.code === code),
      ),
      ...(offer
        ? {
            utilities_rub: Number(draft.utilities_rub),
            deposit_rub: Number(draft.deposit_rub),
            place_note: draft.place_note,
          }
        : {}),
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
        <h2>Что вы ищете</h2>
        <Segmented
          name="scenario"
          options={[
            ['pair', 'Соседа, чтобы вместе снять квартиру'],
            ['room_offer', 'Жильца на свободное место в моей квартире'],
          ]}
          value={draft.scenario}
          onChange={(v) => set('scenario', v)}
        />
        {offer ? (
          <p className="hint">
            Вы один раз опишете место, расходы и уклад квартиры — кандидаты увидят их до первого сообщения.
          </p>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={draft.accepts_room}
              onChange={(e) => set('accepts_room', e.target.checked)}
            />
            Готов(а) заехать на свободное место в уже снятой квартире
          </label>
        )}
      </section>

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
        <h2>{offer ? 'Свободное место' : 'Условия поиска'}</h2>
        <p className="hint">По ним вы увидите только подходящих людей — и они вас.</p>
        <CityPicker
          cities={cities}
          value={draft.city_id}
          onChange={(id) => set('city_id', id)}
          error={errors.city_id}
        />
        <div className="field">
          <label className="label" htmlFor="districts">
            {offer ? 'Район и адрес без номера дома' : 'Подходящие районы'}{' '}
            <span className="muted">— необязательно</span>
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
        {offer ? (
          <>
            <div className="two-cols">
              <div className="field">
                <label className="label" htmlFor="rent">
                  Аренда за место, ₽ в месяц
                </label>
                <input
                  id="rent"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step={500}
                  value={draft.budget_min_rub}
                  onChange={(e) => set('budget_min_rub', e.target.value)}
                  aria-invalid={errors.budget_max_rub ? true : undefined}
                />
                <FieldError text={errors.budget_max_rub ?? errors.budget_min_rub} />
              </div>
              <div className="field">
                <label className="label" htmlFor="utilities">
                  Коммунальные на человека, ₽ в месяц
                </label>
                <input
                  id="utilities"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step={100}
                  placeholder="примерно"
                  value={draft.utilities_rub}
                  onChange={(e) => set('utilities_rub', e.target.value)}
                  aria-invalid={errors.utilities_rub ? true : undefined}
                />
                <FieldError text={errors.utilities_rub} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="deposit">
                Залог при заселении, ₽
              </label>
              <input
                id="deposit"
                type="number"
                required
                min={0}
                max={1000000}
                step={500}
                value={draft.deposit_rub}
                onChange={(e) => set('deposit_rub', e.target.value)}
                aria-invalid={errors.deposit_rub ? true : undefined}
              />
              <FieldError text={errors.deposit_rub} />
              {draft.budget_min_rub !== '' && draft.deposit_rub !== '' && draft.utilities_rub !== '' && (
                <p className="info small">
                  Кандидат увидит: при заселении {formatRub(rent + deposit)}, дальше около{' '}
                  {formatRub(rent + utilities)} в месяц.
                </p>
              )}
            </div>
            <div className="field">
              <label className="label" htmlFor="place_note">
                О квартире и месте <span className="muted">— необязательно</span>
              </label>
              <textarea
                id="place_note"
                className="input"
                rows={3}
                maxLength={500}
                placeholder="Например: комната 12 м², две соседки, 7 минут до метро"
                value={draft.place_note}
                onChange={(e) => set('place_note', e.target.value)}
                aria-invalid={errors.place_note ? true : undefined}
              />
              <FieldError text={errors.place_note} />
            </div>
          </>
        ) : (
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
        )}
        <div className="field">
          <span className="label">{offer ? 'Место свободно' : 'Когда готовы заселиться'}</span>
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
          <h2>{offer ? 'Уклад квартиры и ваши привычки' : 'Бытовые привычки'}</h2>
          <span className={`chip ${answered === questionnaire.questions.length ? 'chip-good' : 'chip-info'}`}>
            Отвечено {answered} из {questionnaire.questions.length}
          </span>
        </div>
        <p className="hint">
          Ваши ответы увидят рядом со своими — так сразу понятно, где вы совпадаете, а о чём договориться.
          Отметьте «обязательно», если не готовы жить с тем, кто ответил иначе: такие люди не попадут в
          выдачу, а вы — к ним.
        </p>
        {questionnaire.questions.map((q) => (
          <div key={q.code} className="field">
            <div className="row">
              <span className="label">{q.title}</span>
              <label className="check small">
                <input
                  type="checkbox"
                  checked={draft.required_habits.includes(q.code)}
                  onChange={() => toggleRequired(q.code)}
                />
                обязательно
              </label>
            </div>
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
        <FieldError text={errors.required_habits} />
      </section>

      <section className="panel form-section">
        <h2>Показывать анкету</h2>
        <Segmented
          name="search_status"
          options={[
            ['searching', offer ? 'Да, ищу жильца' : 'Да, ищу соседа'],
            ['paused', 'Нет, поиск на паузе'],
            ['found', 'Сосед найден'],
          ]}
          value={draft.search_status}
          onChange={(v) => set('search_status', v)}
        />
        <p className="hint">
          На паузе вашу анкету никто не видит, но вы по-прежнему можете смотреть кандидатов. Когда
          договоритесь о заселении, отметьте «Сосед найден»: анкета скроется, а поиск можно будет возобновить.
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
