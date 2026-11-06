/**
 * Окно входа внутри приложения: страница OIDC-провайдера (Keycloak) во
 * встроенном WebView вместо внешнего браузера.
 *
 * Возврат на redirect URI (sozhiteli://auth/callback?code=…) перехватывается
 * здесь же и отдаётся в onRedirect, поэтому вход не зависит от того, вернёт
 * ли браузер телефона управление приложению. Страницы входа, регистрации и
 * сброса пароля - те же, что на сайте; пароль приложение не получает.
 * Режим incognito не сохраняет cookie провайдера: после выхода следующий
 * вход снова спросит пароль.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { Loading, T, useTheme } from '@/components/ui';

export function LoginWebView({
  url,
  redirectUri,
  onRedirect,
  onCancel,
}: {
  url: string;
  redirectUri: string;
  onRedirect: (url: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();

  // Возвращает false для redirect URI: WebView не пытается открыть ссылку
  // sozhiteli://, а приложение забирает из неё код.
  const intercept = (request: WebViewNavigation | { url: string }) => {
    if (request.url.startsWith(redirectUri)) {
      onRedirect(request.url);
      return false;
    }
    return true;
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.screen, { backgroundColor: t.surface }]}>
        <View style={[styles.bar, { borderColor: t.line }]}>
          <T bold size={16}>
            Вход в «Сожители»
          </T>
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12}>
            <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>Отмена</Text>
          </Pressable>
        </View>
        <WebView
          source={{ uri: url }}
          incognito
          originWhitelist={['https://*', 'http://*', 'sozhiteli://*']}
          onShouldStartLoadWithRequest={intercept}
          onNavigationStateChange={(state) => {
            // Подстраховка для переходов, которые Android не передаёт в
            // onShouldStartLoadWithRequest (например, редирект после POST).
            if (state.url.startsWith(redirectUri)) intercept(state);
          }}
          startInLoadingState
          renderLoading={() => <Loading />}
          setSupportMultipleWindows={false}
          style={{ flex: 1 }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
});
