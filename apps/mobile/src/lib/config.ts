/**
 * Конфигурация мобильного приложения. Значения подставляются при сборке из
 * переменных EXPO_PUBLIC_* (см. .env.example); обращаться к process.env в
 * других файлах не нужно.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}. Выполните npm run setup.`);
  }
  return value;
}

export const config = {
  apiBaseUrl: required('EXPO_PUBLIC_API_BASE_URL', process.env.EXPO_PUBLIC_API_BASE_URL),
  oidcIssuer: required('EXPO_PUBLIC_OIDC_ISSUER', process.env.EXPO_PUBLIC_OIDC_ISSUER),
  oidcClientId: required('EXPO_PUBLIC_OIDC_CLIENT_ID', process.env.EXPO_PUBLIC_OIDC_CLIENT_ID),
  /** Схема deep link; совпадает с "scheme" в app.json и redirect URI клиента в OIDC-провайдере. */
  scheme: 'sozhiteli',
} as const;
