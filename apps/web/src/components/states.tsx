import { type Problem, problemMessage } from '@sozhiteli/api-client';
import type { ReactNode } from 'react';

export function Loading({ text = 'Загрузка…' }: { text?: string }) {
  return (
    <p className="muted" role="status">
      {text}
    </p>
  );
}

/** Заглушки плиток, пока загружается выдача. */
export function TilesSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid-cards" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="skeleton" />
      ))}
    </ul>
  );
}

/** Ошибка API: текст по коду и идентификатор запроса для поиска в логах. */
export function ErrorMessage({
  problem,
  children,
}: {
  problem: Problem | null | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="alert" role="alert">
      <p>{problemMessage(problem)}</p>
      {children}
      {problem?.request_id && <p className="request-id">Код запроса: {problem.request_id}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2>{title}</h2>
      {children}
    </div>
  );
}
