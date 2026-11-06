/**
 * Аутентификация мобильного приложения: OIDC Authorization Code + PKCE,
 * публичный клиент (ADR-0002 в README.md). На Android и iOS страница входа
 * провайдера открывается во встроенном окне приложения (LoginWebView), которое
 * само перехватывает возврат с кодом: возврат из внешнего браузера по ссылке
 * sozhiteli:// на части телефонов не срабатывал. В веб-режиме - всплывающее
 * окно браузера. Приложение пароль не видит: его вводят на странице провайдера.
 *
 * Refresh token хранится в защищённом хранилище устройства (Keychain /
 * Keystore; см. token-store.ts), access token - только в памяти. Компоненты получают состояние
 * через useAuth(); access token наружу отдаёт только getAccessToken().
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { LoginWebView } from '@/components/login-webview';

import { config } from './config';
import { readRefreshToken, saveRefreshToken } from './token-store';

WebBrowser.maybeCompleteAuthSession();

const redirectUri = AuthSession.makeRedirectUri({ scheme: config.scheme, path: 'auth/callback' });

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  /** Почему не удался последний вход; null - ошибки не было. */
  signInError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Действующий access token или null. Используется клиентом API. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const discovery = AuthSession.useAutoDiscovery(config.oidcIssuer);
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.oidcClientId,
      redirectUri,
      scopes: ['openid'],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery,
  );

  const [status, setStatus] = useState<AuthStatus>('loading');
  const [signInError, setSignInError] = useState<string | null>(null);
  // Открытое окно входа: запрос (state и code_verifier) и адрес страницы.
  const [login, setLogin] = useState<{ request: AuthSession.AuthRequest; url: string } | null>(null);
  const finishLogin = useRef<((url: string | null) => void) | null>(null);
  // Токены живут в ref: их смена не должна перерисовывать дерево компонентов.
  const tokens = useRef<AuthSession.TokenResponse | null>(null);

  const store = useCallback(async (next: AuthSession.TokenResponse | null) => {
    tokens.current = next;
    setStatus(next ? 'authenticated' : 'anonymous');
    try {
      await saveRefreshToken(next?.refreshToken ?? null);
    } catch {
      // Сессия продолжает работать; после перезапуска потребуется вход.
    }
  }, []);

  // Восстановление сессии при запуске по сохранённому refresh token.
  useEffect(() => {
    if (!discovery || status !== 'loading') {
      return;
    }
    let cancelled = false;
    (async () => {
      // Сбой хранилища не должен оставлять приложение в бесконечной загрузке.
      const refreshToken = await readRefreshToken().catch(() => null);
      if (!refreshToken) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        const restored = await AuthSession.refreshAsync(
          { clientId: config.oidcClientId, refreshToken },
          discovery,
        );
        if (!cancelled) await store(restored);
      } catch {
        if (!cancelled) await store(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [discovery, status, store]);

  const exchange = useCallback(
    async (code: string, codeVerifier: string) => {
      if (!discovery) return;
      const exchanged = await AuthSession.exchangeCodeAsync(
        {
          clientId: config.oidcClientId,
          code,
          redirectUri,
          extraParams: { code_verifier: codeVerifier },
        },
        discovery,
      );
      await store(exchanged);
    },
    [discovery, store],
  );

  const runSignIn = useCallback(async () => {
    if (!discovery) {
      throw new Error('Сервер входа недоступен: проверьте интернет и попробуйте ещё раз.');
    }
    if (Platform.OS === 'web') {
      // В браузере встроенного окна нет: обычное всплывающее окно.
      if (!request) return;
      const result = await promptAsync();
      if (result.type === 'success' && result.params.code) {
        await exchange(result.params.code, request.codeVerifier ?? '');
      }
      return;
    }
    // Новый запрос на каждый вход: свежие state и code_verifier.
    const fresh = new AuthSession.AuthRequest({
      clientId: config.oidcClientId,
      redirectUri,
      scopes: ['openid'],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    });
    const url = await fresh.makeAuthUrlAsync(discovery);
    const returned = await new Promise<string | null>((resolve) => {
      finishLogin.current = resolve;
      setLogin({ request: fresh, url });
    });
    finishLogin.current = null;
    setLogin(null);
    if (!returned) return;
    // parseReturnUrl сверяет state и разбирает ошибку провайдера.
    const result = fresh.parseReturnUrl(returned);
    if (result.type === 'success' && result.params.code) {
      await exchange(result.params.code, fresh.codeVerifier ?? '');
      return;
    }
    if (result.type === 'error') {
      throw new Error(result.error?.message ?? 'Провайдер входа вернул ошибку.');
    }
    throw new Error(`Вход не завершён (${result.type}).`);
  }, [discovery, request, promptAsync, exchange]);

  const signIn = useCallback(async () => {
    setSignInError(null);
    try {
      await runSignIn();
    } catch (e) {
      // Без этого сбой обмена кода на токены выглядел как «вход начался заново».
      setSignInError(e instanceof Error ? e.message : String(e));
    }
  }, [runSignIn]);

  const signOut = useCallback(async () => {
    const refreshToken = tokens.current?.refreshToken;
    await store(null);
    if (refreshToken && discovery?.revocationEndpoint) {
      // Отзыв на сервере - по возможности: локально сессия уже завершена.
      await AuthSession.revokeAsync(
        {
          clientId: config.oidcClientId,
          token: refreshToken,
          tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken,
        },
        discovery,
      ).catch(() => undefined);
    }
  }, [discovery, store]);

  // Одно обновление на все одновременные запросы: refresh token одноразовый
  // (ротация в Keycloak), и второе параллельное обновление тем же токеном
  // получало отказ и выходило из аккаунта сразу после входа.
  const refreshing = useRef<Promise<string | null> | null>(null);

  const getAccessToken = useCallback(async () => {
    const current = tokens.current;
    if (!current) {
      return null;
    }
    // Свой запас вместо стандартных 10 минут expo-auth-session: access token
    // живёт 5 минут, и со стандартным запасом он «устаревал» сразу при выдаче.
    if (AuthSession.TokenResponse.isTokenFresh(current, -30)) {
      return current.accessToken;
    }
    if (!discovery || !current.refreshToken) {
      await store(null);
      return null;
    }
    if (!refreshing.current) {
      refreshing.current = current
        .refreshAsync({ clientId: config.oidcClientId }, discovery)
        .then(async (refreshed) => {
          await store(refreshed);
          return refreshed.accessToken;
        })
        .catch(async () => {
          await store(null);
          return null;
        })
        .finally(() => {
          refreshing.current = null;
        });
    }
    return refreshing.current;
  }, [discovery, store]);

  const value = useMemo<AuthState>(
    () => ({ status, signInError, signIn, signOut, getAccessToken }),
    [status, signInError, signIn, signOut, getAccessToken],
  );
  return (
    <AuthContext.Provider value={value}>
      {children}
      {login && (
        <LoginWebView
          url={login.url}
          redirectUri={redirectUri}
          onRedirect={(url) => finishLogin.current?.(url)}
          onCancel={() => finishLogin.current?.(null)}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth вызван вне AuthProvider');
  }
  return value;
}
