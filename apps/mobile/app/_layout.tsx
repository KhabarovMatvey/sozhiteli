import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';

export default function RootLayout() {
  const t = useTheme();
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.surface },
          headerTitleStyle: { color: t.text, fontWeight: '800' },
          headerTintColor: t.accent,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="candidate/[userId]" options={{ title: 'Анкета', headerBackTitle: 'Назад' }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}
