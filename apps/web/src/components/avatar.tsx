/**
 * Аватар без фотографии: инициалы на цветном фоне. Номер цвета считает общий
 * пакет (@sozhiteli/api-client, avatarTone), поэтому у человека один цвет в
 * web и в мобильном приложении. Цвет задаётся классом tone-N из globals.css,
 * а не атрибутом style: CSP запрещает инлайновые стили (src/proxy.ts).
 */
import { avatarTone as toneOf, initials } from '@sozhiteli/api-client';

export { initials };

/** Класс цвета фона (tone-0 … tone-7 в globals.css) для пользователя. */
export function avatarTone(id: string): string {
  return `tone-${toneOf(id)}`;
}

export function Avatar({ id, name, size = 'm' }: { id: string; name: string; size?: 'm' | 'l' }) {
  return (
    <span className={`avatar avatar-${size} ${avatarTone(id)}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
