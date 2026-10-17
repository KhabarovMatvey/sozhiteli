/**
 * Элементы интерфейса мобильного приложения в том же стиле, что и web
 * (apps/web/src/app/globals.css): светло-серый фон, белые карточки со
 * скруглением 16, синие действия, цветные метки совпадений. Без библиотек
 * компонентов - только React Native.
 */
import type { MatchingSchemas, Problem } from '@sozhiteli/api-client';
import {
  avatarTone,
  formatAge,
  formatBudget,
  formatDate,
  initials,
  matchLabel,
  matchTone,
  problemMessage,
  shortDay,
} from '@sozhiteli/api-client';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
} from 'react-native';

import type { City } from '@/lib/reference';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? {
        background: '#0f0f10',
        surface: '#1b1c1e',
        text: '#f2f2f2',
        muted: '#a0a0a0',
        line: '#2e2f31',
        soft: '#25262a',
        accent: '#4aa8ff',
        accentSoft: '#0f2a44',
        accentText: '#ffffff',
        green: '#2fd47a',
        greenSoft: '#0f3322',
        warnSoft: '#3a2c10',
        warnText: '#f2c46d',
        ok: '#6fd391',
        bad: '#ff8a80',
        badSoft: '#3b1a18',
      }
    : {
        background: '#f2f2f2',
        surface: '#ffffff',
        text: '#1a1a1a',
        muted: '#757575',
        line: '#e4e4e4',
        soft: '#f5f5f5',
        accent: '#0a8cf0',
        accentSoft: '#e7f3ff',
        accentText: '#ffffff',
        green: '#00b956',
        greenSoft: '#e5f7ed',
        warnSoft: '#fff5e0',
        warnText: '#8a5a00',
        ok: '#00873f',
        bad: '#e33b2e',
        badSoft: '#fdecea',
      };
}

/** Цвета фона аватаров; номер цвета - avatarTone() из общего пакета. */
const toneColors = ['#4f7fe6', '#1fae93', '#ea7a3a', '#9a5ae6', '#e35a78', '#3a9cd8', '#72ad35', '#d9a334'];

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function T({
  children,
  muted,
  bold,
  size,
  color,
}: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
  size?: number;
  color?: string;
}) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: color ?? (muted ? t.muted : t.text),
        fontWeight: bold ? '700' : '400',
        fontSize: size ?? 15,
        lineHeight: (size ?? 15) * 1.4,
      }}
    >
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <View style={styles.heading}>
      <T bold size={20}>
        {children}
      </T>
    </View>
  );
}

/** Белая карточка-раздел с заголовком. */
export function Panel({
  title,
  right,
  children,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: t.surface }]}>
      {(title || right) && (
        <View style={styles.panelHead}>
          {title && (
            <T bold size={18}>
              {title}
            </T>
          )}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
}

export function ErrorBox({
  problem,
  children,
}: {
  problem: Problem | null | undefined;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: t.badSoft }]} accessibilityRole="alert">
      <T>{problemMessage(problem)}</T>
      {children}
    </View>
  );
}

/** Пояснение (info), подтверждение (ok) или пустое состояние (empty). */
export function Note({
  children,
  kind,
  icon,
}: {
  children: ReactNode;
  kind?: 'ok' | 'empty';
  icon?: string;
}) {
  const t = useTheme();
  const content = typeof children === 'string' ? <T>{children}</T> : children;
  if (kind === 'empty') {
    return (
      <View style={[styles.panel, styles.empty, { backgroundColor: t.surface }]}>
        {icon && <Text style={styles.emptyIcon}>{icon}</Text>}
        {content}
      </View>
    );
  }
  return (
    <View style={[styles.box, { backgroundColor: kind === 'ok' ? t.greenSoft : t.accentSoft }]}>
      {content}
    </View>
  );
}

export function Button({
  title,
  onPress,
  primary,
  success,
  disabled,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  success?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const filled = primary || success;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: success ? t.green : primary ? t.accent : t.soft,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: filled ? t.accentText : t.text,
          fontSize: 16,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  ...input
}: TextInputProps & { label: string; error?: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <T bold>{label}</T>
      <TextInput
        placeholderTextColor={t.muted}
        {...input}
        style={[
          styles.input,
          { color: t.text, backgroundColor: t.soft, borderColor: error ? t.bad : 'transparent' },
        ]}
      />
      {hint && (
        <T muted size={13}>
          {hint}
        </T>
      )}
      {error && <Text style={{ color: t.bad }}>{error}</Text>}
    </View>
  );
}

/** Выбор одного варианта плашками, как на web. */
export function Choice<V extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label?: string;
  options: readonly (readonly [V, string])[];
  value: V | '' | undefined;
  onChange: (v: V) => void;
  error?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      {label && <T bold>{label}</T>}
      <View style={styles.chips} accessibilityRole="radiogroup">
        {options.map(([v, text]) => {
          const selected = value === v;
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(v)}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? t.accentSoft : t.soft,
                  borderColor: selected ? t.accent : 'transparent',
                },
              ]}
            >
              <Text style={{ color: selected ? t.accent : t.text, fontSize: 15, fontWeight: '600' }}>
                {text}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error && <Text style={{ color: t.bad }}>{error}</Text>}
    </View>
  );
}

export type ChipTone = 'good' | 'mid' | 'low' | 'info' | 'none';

export function Chip({ tone = 'none', children }: { tone?: ChipTone; children: ReactNode }) {
  const t = useTheme();
  const colors: Record<ChipTone, [string, string]> = {
    good: [t.greenSoft, t.ok],
    mid: [t.warnSoft, t.warnText],
    low: [t.badSoft, t.bad],
    info: [t.accentSoft, t.accent],
    none: [t.soft, t.muted],
  };
  const [background, color] = colors[tone];
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

type Card = MatchingSchemas['CandidateCard'];

export function MatchChip({ card }: { card: Card }) {
  const { matched_count: matched, compared_count: compared } = card.compatibility;
  return <Chip tone={matchTone(matched, compared)}>{matchLabel(matched, compared)}</Chip>;
}

/** Аватар без фотографии: инициалы на цветном фоне (цвет как в web). */
export function Avatar({ id, name, size = 56 }: { id: string; name: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: toneColors[avatarTone(id)] },
      ]}
      accessible={false}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '800' }}>{initials(name)}</Text>
    </View>
  );
}

function cityName(cities: City[] | undefined, id: number): string | undefined {
  return cities?.find((c) => c.id === id)?.name;
}

/** Плитка кандидата в выдаче — как карточка объявления: обложка слева. */
export function CandidateTile({
  card,
  cities,
  onPress,
}: {
  card: Card;
  cities?: City[];
  onPress: () => void;
}) {
  const t = useTheme();
  const where = [cityName(cities, card.city_id), card.districts].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${candidateTitle(card)}, ${formatBudget(card.budget_min_rub, card.budget_max_rub)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: t.surface, opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={[styles.tileCover, { backgroundColor: toneColors[avatarTone(card.user_id)] }]}>
        <Text style={styles.tileInitials}>{initials(card.display_name)}</Text>
      </View>
      <View style={styles.tileBody}>
        <T bold size={16} color={t.accent}>
          {candidateTitle(card)}
        </T>
        <Text style={[styles.price, { color: t.text }]}>
          {formatBudget(card.budget_min_rub, card.budget_max_rub)}
        </Text>
        <T size={13}>{card.occupation}</T>
        {where ? (
          <T muted size={13}>
            {where}
          </T>
        ) : null}
        <T muted size={13}>
          Заселение {shortDay(card.move_in_from)} — {shortDay(card.move_in_to)}
        </T>
        <View style={styles.row}>
          <MatchChip card={card} />
        </View>
      </View>
    </Pressable>
  );
}

export function CandidateFacts({ card, cities }: { card: Card; cities?: City[] }) {
  const city = cityName(cities, card.city_id);
  const rows: [string, string][] = [
    ['Возраст', formatAge(card.age)],
    ['Учёба или работа', card.occupation],
    ...(city ? ([['Город', city]] as [string, string][]) : []),
    ...(card.districts ? ([['Районы', card.districts]] as [string, string][]) : []),
    ['Бюджет', `${formatBudget(card.budget_min_rub, card.budget_max_rub)} в месяц`],
    ['Заселение', `${formatDate(card.move_in_from)} — ${formatDate(card.move_in_to)}`],
  ];
  return (
    <View style={styles.facts}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.factRow}>
          <View style={styles.factKey}>
            <T muted>{k}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T bold>{v}</T>
          </View>
        </View>
      ))}
    </View>
  );
}

export function candidateTitle(card: Card): string {
  return `${card.display_name}, ${formatAge(card.age)}${card.search_status === 'paused' ? ' · поиск на паузе' : ''}`;
}

export function matchText(card: Card): string {
  const { matched_count: matched, compared_count: compared } = card.compatibility;
  return compared === 0
    ? 'нет общих вопросов для сравнения'
    : `Совпадает привычек: ${matched} из ${compared}`;
}

const shadow = { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)' } as const;

export const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48, gap: 12 },
  heading: { marginTop: 8 },
  center: { padding: 32, alignItems: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  panel: { borderRadius: 16, padding: 16, gap: 14, ...shadow },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  box: { borderRadius: 12, padding: 14, gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyIcon: { fontSize: 40 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18 },
  field: { gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  chip: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  tile: { flexDirection: 'row', borderRadius: 16, overflow: 'hidden', ...shadow },
  tileCover: { width: 104, alignItems: 'center', justifyContent: 'center' },
  tileInitials: { color: '#fff', fontSize: 40, fontWeight: '800' },
  tileBody: { flex: 1, padding: 12, gap: 3 },
  price: { fontSize: 18, fontWeight: '800' },
  facts: { gap: 10 },
  factRow: { flexDirection: 'row', gap: 12 },
  factKey: { width: 130 },
  card: { borderRadius: 16, padding: 16, gap: 10, ...shadow },
});
