/**
 * Конфигурация web-приложения. Значения подставляются при сборке из
 * переменных NEXT_PUBLIC_* (см. .env.example); обращаться к process.env в
 * других файлах не нужно.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}. Выполните npm run setup.`);
  }
  return value;
}

export const config = {
  apiBaseUrl: required('NEXT_PUBLIC_API_BASE_URL', process.env.NEXT_PUBLIC_API_BASE_URL),
  oidcAuthority: required('NEXT_PUBLIC_OIDC_AUTHORITY', process.env.NEXT_PUBLIC_OIDC_AUTHORITY),
  oidcClientId: required('NEXT_PUBLIC_OIDC_CLIENT_ID', process.env.NEXT_PUBLIC_OIDC_CLIENT_ID),
} as const;
