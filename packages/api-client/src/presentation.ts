/**
 * Представление значений контракта для человека: тексты ошибок по кодам,
 * форматирование дат, сумм и контактов, подписи вариантов анкеты.
 *
 * Общие для web и mobile, чтобы оба клиента говорили с пользователем
 * одинаково. Только чистые функции: никаких компонентов интерфейса и
 * обращений к сети.
 */
import type { components as InteractionComponents } from './generated/interaction';
import type { components as ProfileComponents } from './generated/profile';

type Problem = ProfileComponents['schemas']['Problem'];
type Questionnaire = ProfileComponents['schemas']['Questionnaire'];
type Contact = InteractionComponents['schemas']['Contact'];

// --- ошибки ------------------------------------------------------------------

const problemMessages: Record<string, string> = {
  unauthorized: 'Сессия истекла. Войдите снова.',
  profile_not_found: 'Анкета ещё не заполнена.',
  profile_not_ready:
    'Ваша анкета ещё не готова: заполните её или подождите несколько секунд после сохранения.',
  candidate_not_found: 'Анкета не найдена: возможно, её удалили.',
  contact_not_found: 'Контакт ещё не указан.',
  contact_required: 'Сначала укажите свой контакт: обмен контактами всегда взаимный.',
  request_exists: 'Вы уже отправили запрос этому человеку.',
  reverse_request_exists: 'Этот человек уже прислал вам запрос — ответьте на него в разделе «Запросы».',
  already_responded: 'На этот запрос уже ответили.',
  contact_request_not_found: 'Запрос не найден.',
  rate_limited: 'Слишком много запросов. Попробуйте позже.',
  validation_failed: 'Проверьте поля формы.',
  invalid_request: 'Некорректные данные. Обновите страницу и попробуйте снова.',
  service_unavailable: 'Сервис временно недоступен. Попробуйте через минуту.',
  request_timeout: 'Сервер не успел ответить. Попробуйте ещё раз.',
  internal_error: 'Что-то пошло не так. Попробуйте ещё раз.',
  network: 'Не удалось связаться с сервером. Проверьте подключение.',
};

/**
 * Ошибка, которой нет в ответе сервера: запрос не дошёл до сервера или ответ
 * не удалось прочитать (например, браузер заблокировал его по CORS).
 */
export const networkProblem: Problem = {
  type: 'urn:sozhiteli:problem:network',
  title: 'Network error',
  status: 0,
  code: 'network',
};

/**
 * Текст ошибки для пользователя. Выбирается только по `code`: `title` и
 * `detail` предназначены разработчику (README.md, раздел «API»).
 */
export function problemMessage(problem: Problem | null | undefined): string {
  if (!problem) return 'Не удалось связаться с сервером. Проверьте подключение.';
  return problemMessages[problem.code] ?? 'Что-то пошло не так. Попробуйте ещё раз.';
}

const fieldMessages: Record<string, string> = {
  out_of_range: 'Недопустимое значение или длина.',
  contact_not_allowed:
    'Здесь нельзя указывать контакты, ссылки и телефоны: обменяться контактами можно через запрос.',
  too_young: 'Сервис доступен с 18 лет.',
  less_than_min: 'Верхняя граница не может быть меньше нижней.',
  before_from: 'Дата «по» раньше даты «с».',
  in_past: 'Эта дата уже прошла.',
  unsupported_version: 'Анкета обновилась — перезагрузите страницу.',
  unknown_city: 'Выберите город из списка.',
  required: 'Ответьте на вопрос.',
  unknown_option: 'Выберите один из вариантов.',
  unknown_question: 'Анкета обновилась — перезагрузите страницу.',
  invalid_format: 'Неверный формат.',
  self_request: 'Нельзя отправить запрос самому себе.',
};

/** Ошибки полей формы: имя поля → текст. Пусто, если ошибка не про поля. */
export function fieldErrors(problem: Problem | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of problem?.errors ?? []) {
    out[e.field] = fieldMessages[e.code] ?? 'Проверьте значение.';
  }
  return out;
}

// --- форматирование ------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const moneyFormat = new Intl.NumberFormat('ru-RU');

/** «12 ноября 2026 г.» из даты контракта (YYYY-MM-DD) без сдвига часового пояса. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return dateFormat.format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function formatBudget(min: number, max: number): string {
  return `${moneyFormat.format(min)} – ${moneyFormat.format(max)} ₽`;
}

export function formatAge(age: number): string {
  const lastTwo = age % 100;
  const last = age % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${age} лет`;
  if (last === 1) return `${age} год`;
  if (last >= 2 && last <= 4) return `${age} года`;
  return `${age} лет`;
}

/** Ссылка на контакт во внешнем сервисе. Формат значения проверен сервером. */
export function contactUrl(contact: Contact): string {
  const value = encodeURIComponent(contact.value);
  return contact.kind === 'telegram' ? `https://t.me/${value}` : `https://vk.com/${value}`;
}

export function contactLabel(contact: Contact): string {
  return contact.kind === 'telegram' ? `Telegram: @${contact.value}` : `ВКонтакте: vk.com/${contact.value}`;
}

// --- анкета и справочники ----------------------------------------------------

/** Подпись варианта ответа по кодам; сам код, если вопрос или вариант неизвестен. */
export function optionLabel(q: Questionnaire | undefined, questionCode: string, optionCode?: string): string {
  if (!optionCode) return '—';
  const question = q?.questions.find((x) => x.code === questionCode);
  return question?.options.find((o) => o.code === optionCode)?.label ?? optionCode;
}

export function questionTitle(q: Questionnaire | undefined, questionCode: string): string {
  return q?.questions.find((x) => x.code === questionCode)?.title ?? questionCode;
}

/** Нормализация для поиска по городам: регистр и «е»/«ё» не важны. */
export function normalizeForSearch(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е').trim();
}

/** Число цветов фона аватара; сами цвета задают приложения (web - классы tone-N). */
export const AVATAR_TONES = 8;

/**
 * Номер цвета аватара (0 … AVATAR_TONES-1) по id пользователя. Фотографий в
 * анкете нет, поэтому человек узнаётся по инициалам и цвету:
 * в web и в мобильном приложении у него один и тот же цвет.
 */
export function avatarTone(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return h % AVATAR_TONES;
}

/** Инициалы для аватара: первые буквы двух первых слов имени или одна буква. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? '?').slice(0, 1);
  return letters.toUpperCase();
}

const shortMonths = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];

/** «19 окт» — короткая дата для плиток и списков (без Intl: одинаково везде). */
export function shortDay(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return `${d ?? 1} ${shortMonths[(m ?? 1) - 1] ?? ''}`;
}

/** Насколько совпадают бытовые привычки: от этого зависит цвет метки. */
export type MatchTone = 'good' | 'mid' | 'low' | 'none';

export function matchTone(matched: number, compared: number): MatchTone {
  if (compared === 0) return 'none';
  const ratio = matched / compared;
  return ratio >= 0.6 ? 'good' : ratio >= 0.35 ? 'mid' : 'low';
}

/** Текст метки совпадений. */
export function matchLabel(matched: number, compared: number): string {
  return compared === 0 ? 'нет данных для сравнения' : `Совпадает ${matched} из ${compared}`;
}
