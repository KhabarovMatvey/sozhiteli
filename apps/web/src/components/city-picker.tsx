'use client';

import { normalizeForSearch } from '@sozhiteli/api-client';
import { useId, useMemo, useState } from 'react';

import { type City } from '@/lib/reference';

const MAX_SUGGESTIONS = 12;

/**
 * Выбор города из справочника (около 1100 городов) поиском по названию.
 * У городов-тёзок показывается регион.
 */
export function CityPicker({
  cities,
  value,
  onChange,
  error,
}: {
  cities: City[];
  value: number | null;
  onChange: (id: number) => void;
  error?: string;
}) {
  const inputId = useId();
  const selected = cities.find((c) => c.id === value);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(selected === undefined);

  const suggestions = useMemo(() => {
    const q = normalizeForSearch(query);
    if (q.length === 0) return [];
    const starts: City[] = [];
    const contains: City[] = [];
    for (const c of cities) {
      const name = normalizeForSearch(c.name);
      if (name.startsWith(q)) starts.push(c);
      else if (name.includes(q)) contains.push(c);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [cities, query]);

  return (
    <div className="field">
      <label className="label" htmlFor={inputId}>
        Город
      </label>
      {selected && !editing ? (
        <div className="row">
          <span className="chip chip-info chip-lg">
            📍 {selected.name}
            {selected.region !== selected.name && <span className="muted">, {selected.region}</span>}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
            Изменить
          </button>
        </div>
      ) : (
        <>
          <input
            id={inputId}
            type="search"
            autoComplete="off"
            placeholder="Начните вводить название города"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          {suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c.id);
                      setQuery('');
                      setEditing(false);
                    }}
                  >
                    <strong>{c.name}</strong>
                    {c.region !== c.name && <span className="muted">, {c.region}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.length > 0 && suggestions.length === 0 && (
            <p className="hint">Такого города нет в списке.</p>
          )}
        </>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
