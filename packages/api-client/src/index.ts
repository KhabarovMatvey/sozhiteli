/**
 * Типизированный клиент публичных API проекта.
 *
 * Типы в ./generated/ получены из contracts/openapi/*.yaml командой `npm run gen`.
 * Web- и mobile-приложения обращаются к backend ТОЛЬКО через этот пакет: не
 * вызывают fetch напрямую и не описывают типы запросов и ответов вручную.
 * Если нужного endpoint или поля нет - его нет в контракте; изменение контракта
 * согласуется отдельно (README.md, раздел «API»).
 */
import createClient, { type Client, type Middleware } from 'openapi-fetch';

import type { components as InteractionComponents, paths as InteractionPaths } from './generated/interaction';
import type { components as MatchingComponents, paths as MatchingPaths } from './generated/matching';
import type { components as ProfileComponents, paths as ProfilePaths } from './generated/profile';

export type ProfileSchemas = ProfileComponents['schemas'];
export type MatchingSchemas = MatchingComponents['schemas'];
export type InteractionSchemas = InteractionComponents['schemas'];

/** Единый формат ошибки всех API (RFC 9457). Ветвление - по полю code. */
export type Problem = ProfileSchemas['Problem'];

export interface ApiClientOptions {
  /** Адрес edge-прокси без завершающего слэша, например http://localhost:8080 */
  baseUrl: string;
  /**
   * Возвращает действующий access token или null, если пользователь не вошёл.
   * Вызывается перед каждым запросом, поэтому должна сама обновлять токен.
   */
  getAccessToken: () => Promise<string | null> | string | null;
  /** Подменяет fetch (используется в тестах). */
  fetch?: typeof globalThis.fetch;
}

export interface ApiClients {
  profile: Client<ProfilePaths>;
  matching: Client<MatchingPaths>;
  interaction: Client<InteractionPaths>;
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Идентификатор запроса для сопоставления с логами сервера. Не секрет, поэтому
 * достаточно Math.random: crypto.randomUUID недоступен в React Native.
 */
export function newRequestId(): string {
  let id = '';
  for (let i = 0; i < 32; i += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

/** Создаёт клиентов трёх сервисов с общей аутентификацией и X-Request-Id. */
export function createApiClients(options: ApiClientOptions): ApiClients {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const common: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      if (!request.headers.has(REQUEST_ID_HEADER)) {
        request.headers.set(REQUEST_ID_HEADER, newRequestId());
      }
      return request;
    },
  };

  // Каждый вызов создаёт клиента одного сервиса; общий префикс задаёт edge-прокси.
  function clientFor<Paths extends object>(service: string): Client<Paths> {
    const client = createClient<Paths>({ baseUrl: `${baseUrl}/api/${service}`, fetch: options.fetch });
    client.use(common);
    return client;
  }

  return {
    profile: clientFor<ProfilePaths>('profile'),
    matching: clientFor<MatchingPaths>('matching'),
    interaction: clientFor<InteractionPaths>('interaction'),
  };
}

export * from './presentation';

/** Проверяет, что значение - ошибка API в едином формате. */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.status === 'number';
}
