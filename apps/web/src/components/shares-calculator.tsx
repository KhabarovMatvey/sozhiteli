'use client';

/**
 * Калькулятор долей общих расходов (Could №17, S2-04b) внутри договорённости
 * «Платежи и общие покупки». Считает в браузере и только вставляет текст в
 * поле договорённости: отдельно расчёт не хранится.
 */
import {
  MAX_RESIDENTS,
  MIN_RESIDENTS,
  type SharedExpense,
  formatRub,
  sharesText,
  splitShared,
} from '@sozhiteli/api-client';
import { useState } from 'react';

type Row = { label: string; amount: string };

const emptyRows: Row[] = [
  { label: 'интернет', amount: '' },
  { label: 'бытовая химия', amount: '' },
];

export function SharesCalculator({ onInsert }: { onInsert: (text: string) => boolean }) {
  const [residents, setResidents] = useState(2);
  const [rows, setRows] = useState<Row[]>(emptyRows);
  const [tooLong, setTooLong] = useState(false);

  const expenses: SharedExpense[] = rows.map((r) => ({ label: r.label, amountRub: Number(r.amount || 0) }));
  const split = splitShared(expenses, residents);

  function update(index: number, patch: Partial<Row>) {
    setTooLong(false);
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function insert() {
    const text = sharesText(expenses, residents);
    if (text) setTooLong(!onInsert(text));
  }

  return (
    <details className="shares">
      <summary className="small">Посчитать доли общих расходов</summary>
      <div className="stack stack-tight">
        <p className="small muted">
          Аренда и коммунальные в карточке места уже указаны на человека. Здесь — то, что оплачиваете вместе и
          делите поровну.
        </p>
        <label className="field">
          <span className="label small">Сколько жильцов делят расходы</span>
          <select
            className="input"
            value={residents}
            onChange={(e) => {
              setTooLong(false);
              setResidents(Number(e.target.value));
            }}
          >
            {Array.from({ length: MAX_RESIDENTS - MIN_RESIDENTS + 1 }, (_, i) => i + MIN_RESIDENTS).map(
              (n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ),
            )}
          </select>
        </label>
        {rows.map((row, i) => (
          <div key={i} className="shares-row">
            <input
              className="input"
              aria-label="На что"
              placeholder="На что"
              maxLength={40}
              value={row.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <input
              className="input"
              aria-label="Сумма в месяц, ₽"
              placeholder="₽ в месяц"
              inputMode="numeric"
              value={row.amount}
              onChange={(e) => update(i, { amount: e.target.value.replace(/\D/g, '').slice(0, 7) })}
            />
            {rows.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-label="Убрать строку"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {rows.length < 8 && (
          <button
            type="button"
            className="btn btn-ghost btn-small shares-add"
            onClick={() => setRows([...rows, { label: '', amount: '' }])}
          >
            + Добавить расход
          </button>
        )}
        {split ? (
          <p>
            Всего {formatRub(split.totalRub)} в месяц —{' '}
            <strong>
              {split.minRub === split.maxRub
                ? `по ${formatRub(split.minRub)}`
                : `по ${formatRub(split.minRub)} или ${formatRub(split.maxRub)}`}
            </strong>{' '}
            с каждого.
          </p>
        ) : (
          <p className="small muted">Укажите хотя бы одну сумму.</p>
        )}
        <div className="row">
          <button type="button" className="btn btn-small" disabled={!split} onClick={insert}>
            Вставить в договорённость
          </button>
          {tooLong && (
            <span className="field-error small">Не помещается в поле: сократите записанный текст.</span>
          )}
        </div>
      </div>
    </details>
  );
}
