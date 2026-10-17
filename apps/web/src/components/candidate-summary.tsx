import {
  type MatchingSchemas,
  formatAge,
  formatBudget,
  formatDate,
  matchLabel,
  matchTone,
  shortDay,
} from '@sozhiteli/api-client';
import Link from 'next/link';

import type { City } from '@/lib/reference';

import { avatarTone, initials } from './avatar';

type Card = MatchingSchemas['CandidateCard'];

export { shortDay };

const chipTones = { good: 'chip-good', mid: 'chip-mid', low: 'chip-low', none: '' } as const;

/** Метка совпадений: цвет зависит от доли совпавших ответов. */
export function MatchChip({ card, solid }: { card: Card; solid?: boolean }) {
  const { matched_count: matched, compared_count: compared } = card.compatibility;
  const tone = matchTone(matched, compared);
  return (
    <span className={`chip ${solid && tone !== 'none' ? 'chip-solid' : chipTones[tone]}`}>
      {matchLabel(matched, compared)}
    </span>
  );
}

export function cityName(cities: City[] | undefined, id: number): string | undefined {
  return cities?.find((c) => c.id === id)?.name;
}

export function candidateTitle(card: Card): string {
  return `${card.display_name}, ${formatAge(card.age)}`;
}

/** Плитка кандидата в выдаче — как карточка объявления. */
export function CandidateTile({ card, cities }: { card: Card; cities?: City[] }) {
  const city = cityName(cities, card.city_id);
  const where = [city, card.districts].filter(Boolean).join(', ');
  return (
    <Link href={`/candidates/${card.user_id}`} className="tile">
      <div className={`tile-cover ${avatarTone(card.user_id)}`}>
        <span className="avatar-initials">{initials(card.display_name)}</span>
        <span className="tile-badge">
          <MatchChip card={card} solid />
        </span>
      </div>
      <div className="tile-body">
        <span className="tile-title">{candidateTitle(card)}</span>
        <span className="tile-price">{formatBudget(card.budget_min_rub, card.budget_max_rub)}</span>
        <span className="small muted tile-note">в месяц на человека, без коммунальных</span>
        <span className="small">{card.occupation}</span>
        {where && <span className="small muted">{where}</span>}
        <span className="small muted">
          Заселение {shortDay(card.move_in_from)} — {shortDay(card.move_in_to)}
        </span>
        {card.search_status === 'paused' && <span className="chip">поиск на паузе</span>}
      </div>
    </Link>
  );
}

/** Характеристики кандидата списком «название — значение». */
export function CandidateSpecs({ card, cities }: { card: Card; cities?: City[] }) {
  const city = cityName(cities, card.city_id);
  return (
    <dl className="specs">
      <dt>Возраст</dt>
      <dd>{formatAge(card.age)}</dd>
      <dt>Учёба или работа</dt>
      <dd>{card.occupation}</dd>
      {city && (
        <>
          <dt>Город</dt>
          <dd>{city}</dd>
        </>
      )}
      {card.districts && (
        <>
          <dt>Районы</dt>
          <dd>{card.districts}</dd>
        </>
      )}
      <dt>Бюджет</dt>
      <dd>{formatBudget(card.budget_min_rub, card.budget_max_rub)} в месяц</dd>
      <dt>Заселение</dt>
      <dd>
        {formatDate(card.move_in_from)} — {formatDate(card.move_in_to)}
      </dd>
    </dl>
  );
}
