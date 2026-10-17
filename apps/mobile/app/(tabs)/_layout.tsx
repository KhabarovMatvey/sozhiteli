import { Redirect, Tabs } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { Loading, useTheme } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Разделы приложения. Доступны только после входа. */
export default function TabsLayout() {
  const auth = useAuth();
  const t = useTheme();

  if (auth.status === 'loading') return <Loading />;
  if (auth.status === 'anonymous') return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTitleStyle: { color: t.text, fontWeight: '800', fontSize: 20 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.background },
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            onPress={() => void auth.signOut()}
            style={{ paddingHorizontal: 16 }}
          >
            <Text style={{ color: t.accent, fontSize: 15, fontWeight: '700' }}>Выйти</Text>
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen name="candidates" options={{ title: 'Кандидаты' }} />
      <Tabs.Screen name="requests" options={{ title: 'Запросы' }} />
      <Tabs.Screen name="profile" options={{ title: 'Анкета' }} />
      <Tabs.Screen name="contact" options={{ title: 'Контакт' }} />
    </Tabs>
  );
}
