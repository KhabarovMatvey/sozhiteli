'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getUserManager } from '@/lib/auth';

/** Точка возврата от OIDC-провайдера: обменивает код на токены и уходит на главную. */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  // В режиме разработки React вызывает эффекты дважды, а код авторизации одноразовый.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    getUserManager()
      .signinRedirectCallback()
      .then(
        () => router.replace('/'),
        () => setFailed(true),
      );
  }, [router]);

  return (
    <main>
      {failed ? (
        <p>
          Не удалось завершить вход. <Link href="/">Вернуться на главную</Link> и попробовать снова.
        </p>
      ) : (
        <p>Завершаем вход…</p>
      )}
    </main>
  );
}
