/**
 * Content-Security-Policy с одноразовым nonce на каждый запрос.
 *
 * Зачем: токены входа хранятся в браузере (ADR-0002 в README.md), поэтому XSS - главный
 * риск web-приложения. Политика разрешает только скрипты самого приложения с
 * nonce этого запроса и сетевые запросы только к API и провайдеру входа.
 *
 * Next.js сам находит nonce в заголовке запроса и проставляет его своим
 * скриптам, поэтому страницы рендерятся динамически (см. app/layout.tsx).
 * Подробнее: README.md, раздел «Безопасность».
 */
import { NextResponse, type NextRequest } from 'next/server';

import { config as appConfig } from './lib/config';

function origin(url: string): string {
  return new URL(url).origin;
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const api = origin(appConfig.apiBaseUrl);
  const identity = origin(appConfig.oidcAuthority);

  const policy = [
    "default-src 'self'",
    // В режиме разработки React использует eval для отладочной информации.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Сервер разработки вставляет стили без nonce.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data:",
    "font-src 'self'",
    // Браузер обращается только к API и к провайдеру входа (обмен кода на токены).
    `connect-src 'self' ${api} ${identity}`,
    `frame-src ${identity}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${identity}`,
    "frame-ancestors 'none'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Статические файлы и предзагрузка ссылок политика не нужна.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
