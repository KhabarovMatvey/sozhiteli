/**
 * Калькулятор долей общих расходов (функция Could №17, история S2-04b:
 * «уточнять общие покупки и разделение платежей, чтобы избежать споров»).
 *
 * Аренда и коммунальные в карточке свободного места уже указаны на человека
 * (placeCosts), поэтому здесь делится поровну только то, что жильцы
 * оплачивают вместе: интернет, бытовая химия, общие продукты. Результат
 * вставляется текстом в договорённость «Платежи и общие покупки» (№16) и
 * отдельно не хранится. Только чистые функции.
 */

export interface SharedExpense {
  label: string;
  amountRub: number;
}

export interface ShareSplit {
  /** Сумма учтённых расходов в месяц. */
  totalRub: number;
  residents: number;
  /** Доля каждого в рублях; сумма долей равна totalRub. */
  shares: number[];
  minRub: number;
  maxRub: number;
}

export const MIN_RESIDENTS = 2;
export const MAX_RESIDENTS = 8;
export const MAX_EXPENSE_RUB = 1_000_000;

const moneyFormat = new Intl.NumberFormat('ru-RU');
const rub = (value: number) => `${moneyFormat.format(value)} ₽`;

/** Расходы, которые участвуют в расчёте: целая положительная сумма в допустимых пределах. */
export function countedExpenses(expenses: SharedExpense[]): SharedExpense[] {
  return expenses
    .filter((e) => Number.isInteger(e.amountRub) && e.amountRub > 0 && e.amountRub <= MAX_EXPENSE_RUB)
    .map((e) => ({ label: e.label.trim() || 'общие расходы', amountRub: e.amountRub }));
}

/**
 * Делит расходы поровну в целых рублях. Остаток от деления достаётся первым
 * жильцам по рублю, чтобы доли в сумме давали ровно итог. null - число
 * жильцов вне 2–8 или нечего делить.
 */
export function splitShared(expenses: SharedExpense[], residents: number): ShareSplit | null {
  if (!Number.isInteger(residents) || residents < MIN_RESIDENTS || residents > MAX_RESIDENTS) return null;
  const counted = countedExpenses(expenses);
  if (counted.length === 0) return null;
  const totalRub = counted.reduce((sum, e) => sum + e.amountRub, 0);
  const base = Math.floor(totalRub / residents);
  const remainder = totalRub - base * residents;
  const shares = Array.from({ length: residents }, (_, i) => base + (i < remainder ? 1 : 0));
  return { totalRub, residents, shares, minRub: base, maxRub: base + (remainder > 0 ? 1 : 0) };
}

/** Текст для договорённости о платежах; null - нечего делить. */
export function sharesText(expenses: SharedExpense[], residents: number): string | null {
  const split = splitShared(expenses, residents);
  if (!split) return null;
  const items = countedExpenses(expenses)
    .map((e) => `${e.label} ${rub(e.amountRub)}`)
    .join(', ');
  // При 2–8 жильцах родительный падеж всегда «жильцов».
  const each =
    split.minRub === split.maxRub
      ? `по ${rub(split.minRub)}`
      : `по ${moneyFormat.format(split.minRub)}–${rub(split.maxRub)} (разница из-за округления)`;
  return `Общие расходы в месяц: ${items}. Всего ${rub(split.totalRub)}, ${each} с каждого из ${split.residents} жильцов.`;
}

/**
 * Дописывает расчёт к уже записанной договорённости. null - вместе не
 * помещается в лимит поля, тогда пользователь сокращает текст сам.
 */
export function appendToAgreement(
  current: string | undefined,
  addition: string,
  maxLength: number,
): string | null {
  const before = (current ?? '').trim();
  const next = before ? `${before}\n${addition}` : addition;
  return next.length <= maxLength ? next : null;
}
