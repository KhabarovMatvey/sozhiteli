/**
 * Калькулятор долей общих расходов (Could №17, S2-04b). Повторяет
 * apps/web/src/components/shares-calculator.tsx.
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
import { Pressable, TextInput, View } from 'react-native';

import { Button, Choice, T, useTheme } from '@/components/ui';

type Row = { label: string; amount: string };

const residentOptions = Array.from({ length: MAX_RESIDENTS - MIN_RESIDENTS + 1 }, (_, i) => {
  const n = String(i + MIN_RESIDENTS);
  return [n, n] as const;
});

export function SharesCalculator({ onInsert }: { onInsert: (text: string) => boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [residents, setResidents] = useState(2);
  const [rows, setRows] = useState<Row[]>([
    { label: 'интернет', amount: '' },
    { label: 'бытовая химия', amount: '' },
  ]);
  const [tooLong, setTooLong] = useState(false);

  const expenses: SharedExpense[] = rows.map((r) => ({ label: r.label, amountRub: Number(r.amount || 0) }));
  const split = splitShared(expenses, residents);
  const input = {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: t.text,
    backgroundColor: t.soft,
  } as const;

  function update(index: number, patch: Partial<Row>) {
    setTooLong(false);
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <T bold size={14} color={t.accent}>
          Посчитать доли общих расходов
        </T>
      </Pressable>
    );
  }

  return (
    <View
      style={{
        gap: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: t.muted,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <T muted size={13}>
        Аренда и коммунальные в карточке места уже указаны на человека. Здесь — то, что оплачиваете вместе и
        делите поровну.
      </T>
      <Choice
        label="Сколько жильцов делят расходы"
        options={residentOptions}
        value={String(residents)}
        onChange={(v) => {
          setTooLong(false);
          setResidents(Number(v));
        }}
      />
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            style={[input, { flex: 1 }]}
            placeholder="На что"
            placeholderTextColor={t.muted}
            maxLength={40}
            value={row.label}
            onChangeText={(v) => update(i, { label: v })}
          />
          <TextInput
            style={[input, { width: 110 }]}
            placeholder="₽ в месяц"
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
            value={row.amount}
            onChangeText={(v) => update(i, { amount: v.replace(/\D/g, '').slice(0, 7) })}
          />
          {rows.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Убрать строку"
              onPress={() => setRows(rows.filter((_, j) => j !== i))}
              hitSlop={8}
            >
              <T muted>✕</T>
            </Pressable>
          )}
        </View>
      ))}
      {rows.length < 8 && (
        <Pressable accessibilityRole="button" onPress={() => setRows([...rows, { label: '', amount: '' }])}>
          <T bold size={14} color={t.accent}>
            + Добавить расход
          </T>
        </Pressable>
      )}
      {split ? (
        <T>
          Всего {formatRub(split.totalRub)} в месяц —{' '}
          <T bold>
            {split.minRub === split.maxRub
              ? `по ${formatRub(split.minRub)}`
              : `по ${formatRub(split.minRub)} или ${formatRub(split.maxRub)}`}
          </T>{' '}
          с каждого.
        </T>
      ) : (
        <T muted size={13}>
          Укажите хотя бы одну сумму.
        </T>
      )}
      {tooLong && <T color={t.bad}>Не помещается в поле: сократите записанный текст.</T>}
      <Button
        title="Вставить в договорённость"
        disabled={!split}
        onPress={() => {
          const text = sharesText(expenses, residents);
          if (text) setTooLong(!onInsert(text));
        }}
      />
    </View>
  );
}
