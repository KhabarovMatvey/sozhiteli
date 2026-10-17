import { Redirect } from 'expo-router';

/**
 * Адрес возврата от OIDC-провайдера (sozhiteli://auth/callback).
 *
 * На устройстве ответ провайдера перехватывает сессия входа
 * (expo-auth-session), но Android может дополнительно открыть приложение по
 * этой ссылке; в веб-режиме сюда возвращается всплывающее окно, которое
 * закрывает себя само (maybeCompleteAuthSession в src/lib/auth.tsx). Без этого
 * маршрута пользователь увидел бы экран «страница не найдена».
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
