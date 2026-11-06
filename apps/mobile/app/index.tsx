import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Loading, Panel, Screen, T, useTheme } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const features: [string, string, string][] = [
  [
    '🏠',
    'Только подходящие по условиям',
    'Город, бюджет, сроки заселения и пол соседа — неподходящих вы просто не увидите.',
  ],
  [
    '🧽',
    'Привычки видно сразу',
    'Уборка, гости, шум, режим сна, курение — 11 вопросов, и вы заранее знаете, о чём договариваться.',
  ],
  [
    '🤝',
    'Контакты — по согласию',
    'Telegram или ВКонтакте открываются, только когда оба захотели продолжить общение.',
  ],
];

export default function WelcomeScreen() {
  const auth = useAuth();
  const t = useTheme();

  if (auth.status === 'authenticated') return <Redirect href="/candidates" />;
  if (auth.status === 'loading') return <Loading />;

  return (
    <Screen>
      <View style={styles.logo}>
        <View style={[styles.logoMark, { backgroundColor: t.accent }]}>
          <Text style={styles.logoGlyph}>⌂</Text>
        </View>
        <T bold size={24}>
          сожители
        </T>
      </View>
      <Panel>
        <T bold size={28}>
          Найдите соседа, с которым уживётесь
        </T>
        <T muted size={16}>
          Заполните короткую анкету об условиях и бытовых привычках — и ещё до первого сообщения увидите, в
          чём вы совпадаете с другими, а о чём придётся договориться.
        </T>
        <Button primary title="Найти соседа" onPress={() => void auth.signIn()} />
        {auth.signInError && (
          <T size={13} color={t.bad}>
            Не удалось войти: {auth.signInError}
          </T>
        )}
        <T muted size={13}>
          Регистрация — почта и пароль
        </T>
      </Panel>
      {features.map(([icon, title, text]) => (
        <Panel key={title}>
          <View style={styles.feature}>
            <View style={[styles.featureIcon, { backgroundColor: t.accentSoft }]}>
              <Text style={{ fontSize: 22 }}>{icon}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <T bold>{title}</T>
              <T muted size={14}>
                {text}
              </T>
            </View>
          </View>
        </Panel>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  logoMark: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoGlyph: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: -2 },
  feature: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
