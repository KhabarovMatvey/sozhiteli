/**
 * Аутентификация мобильного приложения: OIDC Authorization Code + PKCE,
 * публичный клиент (ADR-0002 в README.md). Вход открывается в системном браузере;
 * приложение пароль не видит.
 *
 * Refresh token хранится в защищённом хранилище устройства (Keychain /
 * Keystore; см. token-store.ts), access token - только в памяти. Компоненты получают состояние
 * через useAuth(); access token наружу отдаёт только getAccessToken().
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
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

import { config } from './config';
import { readRefreshToken, saveRefreshToken } from './token-store';

WebBrowser.maybeCompleteAuthSession();

const redirectUri = AuthSession.makeRedirectUri({ scheme: config.scheme, path: 'auth/callback' });

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
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

  const signIn = useCallback(async () => {
    if (!discovery || !request) {
      return;
    }
    const result = await promptAsync();
    if (result.type !== 'success' || !result.params.code) {
      return;
    }
    const exchanged = await AuthSession.exchangeCodeAsync(
      {
        clientId: config.oidcClientId,
        code: result.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier ?? '' },
      },
      discovery,
    );
    await store(exchanged);
  }, [discovery, request, promptAsync, store]);

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

  const getAccessToken = useCallback(async () => {
    const current = tokens.current;
    if (!current) {
      return null;
    }
    if (!current.shouldRefresh()) {
      return current.accessToken;
    }
    if (!discovery || !current.refreshToken) {
      await store(null);
      return null;
    }
    try {
      const refreshed = await current.refreshAsync({ clientId: config.oidcClientId }, discovery);
      await store(refreshed);
      return refreshed.accessToken;
    } catch {
      await store(null);
      return null;
    }
  }, [discovery, store]);

  const value = useMemo<AuthState>(
    () => ({ status, signIn, signOut, getAccessToken }),
    [status, signIn, signOut, getAccessToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth вызван вне AuthProvider');
  }
  return value;
}
