/** Общая роль встроенного административного интерфейса. */
export const ADMIN_ROLE = 'sozhiteli-admin';

/**
 * Подсказка для интерфейса по access token. Это не проверка подписи и не
 * авторизация: разрешение каждого запроса всегда проверяет сервис.
 */
export function hasRealmRole(accessToken: string | null | undefined, role: string): boolean {
  if (!accessToken) return false;
  try {
    const segments = accessToken.split('.');
    if (segments.length !== 3 || !segments[1] || !/^[A-Za-z0-9_-]+$/.test(segments[1])) return false;
    const payload: unknown = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload !== 'object' || payload === null || !('realm_access' in payload)) return false;
    const access = payload.realm_access;
    return typeof access === 'object' && access !== null && 'roles' in access && Array.isArray(access.roles)
      ? access.roles.some((value: unknown) => typeof value === 'string' && value === role)
      : false;
  } catch {
    return false;
  }
}
