'use client';

/**
 * Аутентификация web-приложения: OIDC Authorization Code + PKCE, публичный
 * клиент (ADR-0002 в README.md). Логин, пароль и регистрацию обрабатывает страница
 * OIDC-провайдера; приложение пароль не видит.
 *
 * Токены хранятся в sessionStorage вкладки. Компоненты получают состояние
 * через useAuth(); access token наружу отдаёт только getAccessToken().
 */
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { ADMIN_ROLE, hasRealmRole } from '@sozhiteli/api-client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { config } from './config';

export const CALLBACK_PATH = '/auth/callback';

let manager: UserManager | null = null;

/** Единственный экземпляр UserManager. Только в браузере. */
export function getUserManager(): UserManager {
  if (typeof window === 'undefined') {
    throw new Error('UserManager доступен только в браузере');
  }
  manager ??= new UserManager({
    authority: config.oidcAuthority,
    client_id: config.oidcClientId,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: 'code',
    scope: 'openid',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  return manager;
}

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  /** Идентификатор пользователя (claim sub) или null. */
  userId: string | null;
  /** Только подсказка для навигации; backend отдельно проверяет роль. */
  isAdmin: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Действующий access token или null. Используется клиентом API. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

function activeUser(user: User | null): User | null {
  return user && !user.expired ? user : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const userManager = getUserManager();
    const apply = (user: User | null) => {
      const current = activeUser(user);
      setUserId(current?.profile.sub ?? null);
      setIsAdmin(hasRealmRole(current?.access_token, ADMIN_ROLE));
      setStatus(current ? 'authenticated' : 'anonymous');
    };

    userManager.getUser().then(apply, () => apply(null));

    const onLoaded = (user: User) => apply(user);
    const onUnloaded = () => apply(null);
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);
    userManager.events.addAccessTokenExpired(onUnloaded);
    return () => {
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
      userManager.events.removeAccessTokenExpired(onUnloaded);
    };
  }, []);

  const signIn = useCallback(() => getUserManager().signinRedirect(), []);
  const signOut = useCallback(() => getUserManager().signoutRedirect(), []);
  const getAccessToken = useCallback(async () => {
    const user = activeUser(await getUserManager().getUser());
    return user?.access_token ?? null;
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, userId, isAdmin, signIn, signOut, getAccessToken }),
    [status, userId, isAdmin, signIn, signOut, getAccessToken],
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
