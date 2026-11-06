import { describe, expect, it } from 'vitest';

import {
  AVATAR_TONES,
  avatarTone,
  contactLabel,
  contactUrl,
  fieldErrors,
  formatAge,
  formatBudget,
  formatDate,
  initials,
  matchLabel,
  matchTone,
  networkProblem,
  normalizeForSearch,
  optionLabel,
  problemMessage,
  questionTitle,
  placeCosts,
  formatRub,
  reportReasonLabel,
  reportReasons,
  shortDay,
} from './presentation';

const problem = (code: string, errors?: { field: string; code: string; message: string }[]) => ({
  type: `urn:sozhiteli:problem:${code}`,
  title: 'x',
  status: 400,
  code,
  errors,
});

describe('problem texts', () => {
  it('chooses the text by code and falls back for unknown codes and network failures', () => {
    expect(problemMessage(problem('contact_required'))).toContain('укажите свой контакт');
    expect(problemMessage(problem('something_new'))).toBe('Что-то пошло не так. Попробуйте ещё раз.');
    expect(problemMessage(null)).toContain('Не удалось связаться');
    expect(problemMessage(networkProblem)).toBe(problemMessage(null));
  });

  it('maps field errors by field name', () => {
    const errors = fieldErrors(
      problem('validation_failed', [
        { field: 'birth_year', code: 'too_young', message: 'x' },
        { field: 'habits.guests', code: 'required', message: 'x' },
        { field: 'districts', code: 'brand_new_code', message: 'x' },
      ]),
    );
    expect(errors['birth_year']).toBe('Сервис доступен с 18 лет.');
    expect(errors['habits.guests']).toBe('Ответьте на вопрос.');
    expect(errors['districts']).toBe('Проверьте значение.');
    expect(fieldErrors(problem('rate_limited'))).toEqual({});
  });
});

describe('formatting', () => {
  it('formats a contract date without a time zone shift', () => {
    expect(formatDate('2026-11-01')).toMatch(/^1 ноября 2026/);
    expect(formatDate('2026-11-01T23:30:00Z')).toMatch(/^1 ноября 2026/);
  });

  it('formats budgets and ages in Russian', () => {
    expect(formatBudget(10000, 15000).replace(/\s/g, ' ')).toBe('10 000 – 15 000 ₽');
    expect([1, 2, 5, 11, 21, 22, 25, 111].map(formatAge)).toEqual([
      '1 год',
      '2 года',
      '5 лет',
      '11 лет',
      '21 год',
      '22 года',
      '25 лет',
      '111 лет',
    ]);
  });

  it('builds contact links and labels', () => {
    expect(contactUrl({ kind: 'telegram', value: 'anna_ch' })).toBe('https://t.me/anna_ch');
    expect(contactUrl({ kind: 'vk', value: 'id123' })).toBe('https://vk.com/id123');
    expect(contactLabel({ kind: 'telegram', value: 'anna_ch' })).toBe('Telegram: @anna_ch');
  });
});

describe('questionnaire labels', () => {
  const q = {
    version: 1,
    questions: [{ code: 'guests', title: 'Гости', options: [{ code: 'none', label: 'Гостей не привожу' }] }],
  };

  it('labels known codes and keeps unknown ones visible', () => {
    expect(questionTitle(q, 'guests')).toBe('Гости');
    expect(optionLabel(q, 'guests', 'none')).toBe('Гостей не привожу');
    expect(optionLabel(q, 'guests', 'freely')).toBe('freely');
    expect(optionLabel(q, 'guests', undefined)).toBe('—');
    expect(questionTitle(undefined, 'pets')).toBe('pets');
  });

  it('normalizes text for city search', () => {
    expect(normalizeForSearch('  Королёв ')).toBe('королев');
  });
});

describe('avatar', () => {
  it('gives one person the same tone everywhere and spreads people across tones', () => {
    expect(avatarTone('9373140b-7803-4da4-a1c6-ec9d1a55d39f')).toBe(
      avatarTone('9373140b-7803-4da4-a1c6-ec9d1a55d39f'),
    );
    const tones = new Set(Array.from({ length: 64 }, (_, i) => avatarTone(`user-${i}`)));
    expect(tones.size).toBe(AVATAR_TONES);
    for (const tone of tones) expect(tone).toBeGreaterThanOrEqual(0);
  });

  it('builds initials from one or two words', () => {
    expect(initials('Боб')).toBe('Б');
    expect(initials('  анна  мария ')).toBe('АМ');
    expect(initials('')).toBe('?');
  });
});

describe('short texts for cards', () => {
  it('formats a short day without Intl', () => {
    expect(shortDay('2026-10-19')).toBe('19 окт');
    expect(shortDay('2026-05-01')).toBe('1 мая');
  });

  it('picks the match tone by the share of matched answers', () => {
    expect(matchTone(5, 8)).toBe('good');
    expect(matchTone(3, 8)).toBe('mid');
    expect(matchTone(0, 8)).toBe('low');
    expect(matchTone(0, 0)).toBe('none');
    expect(matchLabel(4, 8)).toBe('Совпадает 4 из 8');
    expect(matchLabel(0, 0)).toBe('нет данных для сравнения');
  });
});

describe('report reasons', () => {
  it('covers every contract reason once and labels them', () => {
    const codes = reportReasons.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(['commercial', 'fake', 'fraud', 'offensive', 'other']);
    expect(reportReasonLabel('fraud')).toBe('Просит деньги или предоплату');
  });

  it('explains safety error codes', () => {
    for (const code of ['blocked', 'block_limit', 'report_exists']) {
      expect(problemMessage({ type: '', title: '', status: 409, code })).not.toBe(
        problemMessage({ type: '', title: '', status: 409, code: 'unknown_code' }),
      );
    }
  });
});

describe('free place costs', () => {
  it('sums the move-in and monthly payments only for a free place', () => {
    expect(
      placeCosts({ scenario: 'room_offer', budget_min_rub: 12000, utilities_rub: 3000, deposit_rub: 12000 }),
    ).toEqual({ rent: 12000, utilities: 3000, deposit: 12000, moveIn: 24000, monthly: 15000 });
    expect(placeCosts({ scenario: 'pair', budget_min_rub: 12000 })).toBeNull();
    expect(formatRub(12000)).toMatch(/^12\s000 ₽$/);
  });
});
