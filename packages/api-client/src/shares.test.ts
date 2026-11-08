import { describe, expect, it } from 'vitest';

import { appendToAgreement, countedExpenses, sharesText, splitShared } from './shares';

const plain = (s: string | null) => s?.replace(/\s/g, ' ') ?? null;

describe('shared expenses split', () => {
  it('splits evenly when the total divides', () => {
    expect(
      splitShared(
        [
          { label: 'интернет', amountRub: 800 },
          { label: 'бытовая химия', amountRub: 1200 },
        ],
        2,
      ),
    ).toEqual({ totalRub: 2000, residents: 2, shares: [1000, 1000], minRub: 1000, maxRub: 1000 });
  });

  it('gives the remainder rouble by rouble so shares add up to the total', () => {
    const split = splitShared([{ label: 'интернет', amountRub: 1000 }], 3);
    expect(split?.shares).toEqual([334, 333, 333]);
    expect(split?.shares.reduce((a, b) => a + b, 0)).toBe(1000);
    expect([split?.minRub, split?.maxRub]).toEqual([333, 334]);
  });

  it('ignores empty, negative, fractional and too large amounts and names unnamed rows', () => {
    expect(
      countedExpenses([
        { label: ' ', amountRub: 500 },
        { label: 'ноль', amountRub: 0 },
        { label: 'минус', amountRub: -1 },
        { label: 'дробь', amountRub: 1.5 },
        { label: 'много', amountRub: 1_000_001 },
      ]),
    ).toEqual([{ label: 'общие расходы', amountRub: 500 }]);
  });

  it('refuses residents outside 2–8 and an empty list', () => {
    const one = [{ label: 'интернет', amountRub: 800 }];
    expect(splitShared(one, 1)).toBeNull();
    expect(splitShared(one, 9)).toBeNull();
    expect(splitShared(one, 2.5)).toBeNull();
    expect(splitShared([], 2)).toBeNull();
  });
});

describe('agreement text', () => {
  it('describes the items, the total and each share', () => {
    expect(
      plain(
        sharesText(
          [
            { label: 'интернет', amountRub: 800 },
            { label: 'химия', amountRub: 1200 },
          ],
          2,
        ),
      ),
    ).toBe(
      'Общие расходы в месяц: интернет 800 ₽, химия 1 200 ₽. Всего 2 000 ₽, по 1 000 ₽ с каждого из 2 жильцов.',
    );
    expect(plain(sharesText([{ label: 'интернет', amountRub: 1000 }], 3))).toContain(
      'по 333–334 ₽ (разница из-за округления) с каждого из 3 жильцов',
    );
    expect(sharesText([], 2)).toBeNull();
  });

  it('appends on a new line and refuses to overflow the field', () => {
    expect(appendToAgreement(undefined, 'расчёт', 300)).toBe('расчёт');
    expect(appendToAgreement('  до 10-го числа ', 'расчёт', 300)).toBe('до 10-го числа\nрасчёт');
    expect(appendToAgreement('x'.repeat(295), 'расчёт', 300)).toBeNull();
  });
});
