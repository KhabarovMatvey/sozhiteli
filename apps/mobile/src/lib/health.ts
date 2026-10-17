/**
 * Проверка готовности сервисов через edge-прокси. /readyz - служебный
 * endpoint вне OpenAPI-контрактов, поэтому это единственное место, где
 * разрешён прямой fetch.
 */
import { config } from './config';

export const SERVICES = ['profile', 'matching', 'interaction'] as const;
export type ServiceName = (typeof SERVICES)[number];

export async function isServiceReady(service: ServiceName): Promise<boolean> {
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/${service}/readyz`);
    return response.ok;
  } catch {
    return false;
  }
}
