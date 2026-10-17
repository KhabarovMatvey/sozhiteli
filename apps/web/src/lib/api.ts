'use client';

/**
 * Доступ к backend из компонентов.
 *
 *   const api = useApi();
 *   const { data, error } = await api.profile.GET('/v1/questionnaire');
 *
 * data и error типизированы по контракту. error - единый формат ошибки
 * (Problem); ветвление - по error.code. Список операций и кодов ошибок:
 * contracts/openapi/*.yaml и docs/API_CONTRACTS.md.
 */
import { createApiClients, type ApiClients } from '@sozhiteli/api-client';
import { useMemo } from 'react';

import { useAuth } from './auth';
import { config } from './config';

export function useApi(): ApiClients {
  const { getAccessToken } = useAuth();
  return useMemo(() => createApiClients({ baseUrl: config.apiBaseUrl, getAccessToken }), [getAccessToken]);
}
