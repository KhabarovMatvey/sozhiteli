import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { Header } from '@/components/header';
import { AuthProvider } from '@/lib/auth';

import './globals.css';

// Шрифт собирается в само приложение при сборке: внешних запросов из браузера нет.
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Сожители — соседи для совместной аренды',
  description: 'Найдите соседа для совместной аренды и заранее узнайте, совпадают ли ваши бытовые привычки',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Каждая страница рендерится по запросу: так Next.js может проставить
  // скриптам одноразовый nonce из Content-Security-Policy (src/proxy.ts).
  await connection();

  return (
    <html lang="ru" className={manrope.variable}>
      <body>
        <AuthProvider>
          <Header />
          {children}
          <footer className="site-footer">
            Сожители — учебный проект. Контакт собеседника виден только после взаимного согласия.
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
