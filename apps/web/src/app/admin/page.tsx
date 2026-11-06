'use client';

import type { InteractionSchemas, MatchingSchemas, ProfileSchemas, Problem } from '@sozhiteli/api-client';
import {
  formatBudget,
  networkProblem,
  problemMessage,
  reportReasonLabel,
  shortDay,
} from '@sozhiteli/api-client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ProfileForm } from '@/components/profile-form';
import { RequireAuth } from '@/components/require-auth';
import { EmptyState, ErrorMessage, Loading } from '@/components/states';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCities, useQuestionnaire } from '@/lib/reference';

type Database =
  ProfileSchemas['AdminDatabase'] | MatchingSchemas['AdminDatabase'] | InteractionSchemas['AdminDatabase'];
type Rows = ProfileSchemas['AdminTableRows'];
type Users = ProfileSchemas['AdminUserList'];
type Profile = ProfileSchemas['Profile'];
type Profiles = ProfileSchemas['AdminProfileList'];
type Service = 'profile' | 'matching' | 'interaction';
type Tab = 'overview' | 'reports' | 'users' | 'profiles' | 'databases';
type Reports = InteractionSchemas['AdminReportPage'];
type ReportStatus = InteractionSchemas['ReportStatus'];
type QueryResult<T> = { data?: T; error?: Problem };
type QueryState<T> = { data: T | null; error: Problem | null; loading: boolean; failed: boolean };

const services: { key: Service; title: string; description: string }[] = [
  { key: 'profile', title: 'Profile', description: 'Анкеты, города и изменения профилей' },
  { key: 'matching', title: 'Matching', description: 'Кандидаты, просмотры и синхронизация' },
  { key: 'interaction', title: 'Interaction', description: 'Запросы на обмен и сведения о контактах' },
];

function useAdminQuery<T>(key: string, load: () => Promise<QueryResult<T>>): QueryState<T> {
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: Problem | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    load()
      .then(({ data, error }) => {
        if (!cancelled) setResult({ key, data: data ?? null, error: error ?? null, failed: !data });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, data: null, error: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, load]);
  if (!result || result.key !== key) return { data: null, error: null, failed: false, loading: true };
  return { ...result, loading: false };
}

function bytes(value: number): string {
  if (value < 1024 * 1024)
    return `${(value / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
  return `${(value / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
}

function date(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ru-RU');
}

function QueryError({ state }: { state: { error: Problem | null } }) {
  return <ErrorMessage problem={state.error} />;
}

function Overview({ revision }: { revision: number }) {
  const api = useApi();
  const profile = useAdminQuery(
    `profile-${revision}`,
    useCallback(() => api.profile.GET('/v1/admin/database'), [api]),
  );
  const matching = useAdminQuery(
    `matching-${revision}`,
    useCallback(() => api.matching.GET('/v1/admin/database'), [api]),
  );
  const interaction = useAdminQuery(
    `interaction-${revision}`,
    useCallback(() => api.interaction.GET('/v1/admin/database'), [api]),
  );
  const users = useAdminQuery(
    `accounts-${revision}`,
    useCallback(() => api.profile.GET('/v1/admin/users', { params: { query: { limit: 1 } } }), [api]),
  );
  const states = [profile, matching, interaction];
  return (
    <div className="stack">
      <section className="panel admin-intro">
        <div>
          <p className="admin-eyebrow">УЧЁТНЫЕ ЗАПИСИ</p>
          <h2>Пользователи проекта</h2>
          <p className="muted">
            Все зарегистрированные аккаунты, включая пользователей без анкеты. Служебные аккаунты отмечены
            отдельно.
          </p>
        </div>
        {users.loading ? (
          <Loading />
        ) : users.failed ? (
          <QueryError state={users} />
        ) : (
          <strong className="admin-number">{users.data?.total.toLocaleString('ru-RU')}</strong>
        )}
      </section>
      <div className="admin-service-grid">
        {services.map((service, index) => {
          const state = states[index]!;
          return (
            <section className="panel stack" key={service.key}>
              <div className="admin-card-head">
                <h2>{service.title}</h2>
                <span
                  className={`admin-status ${state.data ? 'admin-status-ok' : state.failed ? 'admin-status-error' : ''}`}
                >
                  {state.loading ? 'Проверяем…' : state.data ? 'Доступен' : 'Недоступен'}
                </span>
              </div>
              <p className="muted">{service.description}</p>
              {state.failed && <QueryError state={state} />}
              {state.data && (
                <>
                  <div className="admin-db-caption">
                    <code>{state.data.database}</code>
                    <span>{bytes(state.data.size_bytes)}</span>
                  </div>
                  <dl className="admin-counts">
                    {state.data.tables.map((table) => (
                      <div key={table.name}>
                        <dt>{table.label}</dt>
                        <dd>{table.row_count.toLocaleString('ru-RU')}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </section>
          );
        })}
      </div>
      <p className="muted small">
        Состояние сервисов определяется доступностью их административного API и собственной базы на момент
        запроса.
      </p>
    </div>
  );
}

function Pagination({
  next,
  history,
  onPage,
}: {
  next: string | null;
  history: (string | undefined)[];
  onPage: (direction: 'previous' | 'next', cursor?: string) => void;
}) {
  return (
    <div className="admin-pagination">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={history.length === 0}
        onClick={() => onPage('previous')}
      >
        ← Назад
      </button>
      <span className="muted small">Страница {history.length + 1}</span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={!next}
        onClick={() => onPage('next', next ?? undefined)}
      >
        Далее →
      </button>
    </div>
  );
}

/**
 * Очередь жалоб. Рассмотрение ручное: администратор открывает анкету, при
 * необходимости исправляет или удаляет её и отмечает жалобу рассмотренной.
 */
function ReportsPanel({
  revision,
  onEdit,
  onChanged,
}: {
  revision: number;
  onEdit: (userId: string) => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const [status, setStatus] = useState<ReportStatus>('open');
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const load = useCallback(
    () => api.interaction.GET('/v1/admin/reports', { params: { query: { status, limit: 20, cursor } } }),
    [api, status, cursor],
  );
  const state = useAdminQuery<Reports>(JSON.stringify([status, cursor, revision]), load);

  function page(direction: 'previous' | 'next', next?: string) {
    if (direction === 'next') {
      setHistory([...history, cursor]);
      setCursor(next);
    } else {
      setCursor(history.at(-1));
      setHistory(history.slice(0, -1));
    }
  }
  function show(next: ReportStatus) {
    setStatus(next);
    setCursor(undefined);
    setHistory([]);
  }
  async function resolve(id: string) {
    setBusy(id);
    setProblem(null);
    const { error } = await api.interaction.POST('/v1/admin/reports/{report_id}/resolve', {
      params: { path: { report_id: id } },
    });
    setBusy(null);
    if (error) setProblem(error);
    else onChanged();
  }

  return (
    <section className="panel stack">
      <div className="page-head">
        <div>
          <h2>Жалобы</h2>
          <p className="muted small">
            Откройте анкету, при необходимости исправьте или удалите её, затем отметьте жалобу рассмотренной.
          </p>
        </div>
      </div>
      <div className="admin-tabs" aria-label="Статус жалоб">
        {(
          [
            ['open', 'Открытые'],
            ['resolved', 'Рассмотренные'],
          ] as const
        ).map(([key, title]) => (
          <button
            key={key}
            type="button"
            className={status === key ? 'admin-tab admin-tab-active' : 'admin-tab'}
            onClick={() => show(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {problem && (
        <div className="alert" role="alert">
          <p>{problemMessage(problem)}</p>
        </div>
      )}
      {state.loading ? (
        <Loading />
      ) : state.failed ? (
        <QueryError state={state} />
      ) : state.data?.items.length === 0 ? (
        <EmptyState title={status === 'open' ? 'Открытых жалоб нет' : 'Рассмотренных жалоб нет'}>
          <p className="muted">Жалобы появляются здесь, когда пользователи их отправляют.</p>
        </EmptyState>
      ) : (
        state.data && (
          <>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Поступила</th>
                    <th>Причина</th>
                    <th>Комментарий</th>
                    <th>На кого</th>
                    <th>Открытых на него</th>
                    <th>От кого</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((report) => (
                    <tr key={report.id}>
                      <td>{date(report.created_at)}</td>
                      <td>{reportReasonLabel(report.reason)}</td>
                      <td className="admin-cell">{report.comment || '—'}</td>
                      <td>
                        <code>{report.reported_id}</code>
                      </td>
                      <td>{report.reported_open_count}</td>
                      <td>
                        <code>{report.reporter_id}</code>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onEdit(report.reported_id)}
                          >
                            Открыть анкету
                          </button>
                          {report.status === 'open' ? (
                            <button
                              type="button"
                              className="btn"
                              disabled={busy === report.id}
                              onClick={() => void resolve(report.id)}
                            >
                              Рассмотрена
                            </button>
                          ) : (
                            <span className="muted small">{date(report.resolved_at ?? null)}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination next={state.data.next_cursor} history={history} onPage={page} />
          </>
        )
      )}
    </section>
  );
}

function UsersPanel({ revision, onEdit }: { revision: number; onEdit: (userId: string) => void }) {
  const api = useApi();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const load = useCallback(
    () =>
      api.profile.GET('/v1/admin/users', {
        params: { query: { limit: 20, cursor, search: search || undefined } },
      }),
    [api, cursor, search],
  );
  const state = useAdminQuery<Users>(JSON.stringify([search, cursor, revision]), load);

  function find(event: FormEvent) {
    event.preventDefault();
    setCursor(undefined);
    setHistory([]);
    setSearch(draft.trim());
  }
  function page(direction: 'previous' | 'next', next?: string) {
    if (direction === 'next') {
      setHistory([...history, cursor]);
      setCursor(next);
    } else {
      setCursor(history.at(-1));
      setHistory(history.slice(0, -1));
    }
  }
  return (
    <section className="panel stack">
      <div className="page-head">
        <div>
          <h2>Пользователи</h2>
          <p className="muted small">Учётные записи из Keycloak; наличие анкеты не требуется.</p>
        </div>
        {state.data && <span className="admin-status">Найдено: {state.data.total}</span>}
      </div>
      <form className="admin-search" onSubmit={find}>
        <label className="admin-search-field">
          <span className="small muted">Почта или имя пользователя</span>
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={128}
            placeholder="Найти пользователя"
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Найти
        </button>
      </form>
      {state.loading ? (
        <Loading />
      ) : state.failed ? (
        <QueryError state={state} />
      ) : state.data?.items.length === 0 ? (
        <EmptyState title="Пользователи не найдены">
          <p className="muted">Попробуйте другой запрос.</p>
        </EmptyState>
      ) : (
        state.data && (
          <>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Почта</th>
                    <th>Тип</th>
                    <th>Доступ</th>
                    <th>Анкета</th>
                    <th>Почта подтверждена</th>
                    <th>Регистрация</th>
                    <th>ID</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.email || '—'}</td>
                      <td>{user.service_account ? 'Служебный' : 'Пользователь'}</td>
                      <td>
                        <span
                          className={`admin-status ${user.enabled ? 'admin-status-ok' : 'admin-status-error'}`}
                        >
                          {user.enabled ? 'Активен' : 'Отключён'}
                        </span>
                      </td>
                      <td>
                        {user.service_account ? (
                          '—'
                        ) : (
                          <span className={`admin-status ${user.has_profile ? 'admin-status-ok' : ''}`}>
                            {user.has_profile ? 'Есть' : 'Нет'}
                          </span>
                        )}
                      </td>
                      <td>{user.email_verified ? 'Да' : 'Нет'}</td>
                      <td>{date(user.created_at)}</td>
                      <td>
                        <code>{user.id}</code>
                      </td>
                      <td>
                        {user.service_account ? null : (
                          <button type="button" className="btn btn-ghost" onClick={() => onEdit(user.id)}>
                            {user.has_profile ? 'Открыть анкету' : 'Создать анкету'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination next={state.data.next_cursor} history={history} onPage={page} />
          </>
        )
      )}
    </section>
  );
}

function TableData({ service, table, revision }: { service: Service; table: string; revision: number }) {
  const api = useApi();
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const load = useCallback(async (): Promise<QueryResult<Rows>> => {
    const params = { path: { table }, query: { limit: 20, cursor } };
    if (service === 'profile') {
      if (table !== 'profile' && table !== 'city' && table !== 'profile_deletion') return {};
      return api.profile.GET('/v1/admin/tables/{table}', { params: { ...params, path: { table } } });
    }
    if (service === 'matching') return api.matching.GET('/v1/admin/tables/{table}', { params });
    return api.interaction.GET('/v1/admin/tables/{table}', { params });
  }, [api, service, table, cursor]);
  const state = useAdminQuery<Rows>(JSON.stringify([service, table, cursor, revision]), load);
  function page(direction: 'previous' | 'next', next?: string) {
    if (direction === 'next') {
      setHistory([...history, cursor]);
      setCursor(next);
    } else {
      setCursor(history.at(-1));
      setHistory(history.slice(0, -1));
    }
  }
  if (state.loading) return <Loading text="Загружаем строки…" />;
  if (state.failed) return <QueryError state={state} />;
  if (!state.data) return null;
  return (
    <div className="stack">
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {state.data.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.data.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td className="admin-cell" key={column}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.data.rows.length === 0 && <p className="muted">В этой таблице пока нет записей.</p>}
      <Pagination next={state.data.next_cursor} history={history} onPage={page} />
    </div>
  );
}

function DatabasePanel({ service, revision }: { service: Service; revision: number }) {
  const api = useApi();
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async (): Promise<QueryResult<Database>> => {
    if (service === 'profile') return api.profile.GET('/v1/admin/database');
    if (service === 'matching') return api.matching.GET('/v1/admin/database');
    return api.interaction.GET('/v1/admin/database');
  }, [api, service]);
  const state = useAdminQuery<Database>(`${service}-${revision}`, load);
  if (state.loading) return <Loading />;
  if (state.failed) return <QueryError state={state} />;
  if (!state.data) return null;
  const table = state.data.tables.find((item) => item.name === selected) ?? state.data.tables[0];
  return (
    <div className="stack">
      <div className="admin-db-caption">
        <code>{state.data.database}</code>
        <span className="muted">Размер: {bytes(state.data.size_bytes)}</span>
      </div>
      <div className="admin-table-pills" aria-label="Таблицы базы данных">
        {state.data.tables.map((item) => (
          <button
            className={`btn ${table?.name === item.name ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            key={item.name}
            onClick={() => setSelected(item.name)}
            aria-pressed={table?.name === item.name}
          >
            {item.label} <span className="admin-pill-count">{item.row_count}</span>
          </button>
        ))}
      </div>
      {table && (
        <>
          <div>
            <h3>{table.label}</h3>
            <p className="muted small">
              <code>{table.name}</code> · записей: {table.row_count}
            </p>
          </div>
          <TableData
            key={`${service}-${table.name}-${revision}`}
            service={service}
            table={table.name}
            revision={revision}
          />
        </>
      )}
    </div>
  );
}

function DatabasesPanel({ revision }: { revision: number }) {
  const [service, setService] = useState<Service>('profile');
  return (
    <section className="panel stack">
      <div>
        <h2>Базы данных</h2>
        <p className="muted">Выберите сервис и таблицу, чтобы посмотреть записи.</p>
      </div>
      <div className="admin-tabs" aria-label="Базы сервисов">
        {services.map((item) => (
          <button
            type="button"
            key={item.key}
            className={item.key === service ? 'admin-tab admin-tab-active' : 'admin-tab'}
            onClick={() => setService(item.key)}
            aria-pressed={item.key === service}
          >
            {item.title}
          </button>
        ))}
      </div>
      <DatabasePanel key={service} service={service} revision={revision} />
      {service === 'interaction' && (
        <p className="muted small">
          Контакты отображаются только как факт наличия и тип. Значения Telegram/VK сохраняют действующий
          порядок раскрытия по взаимному согласию.
        </p>
      )}
    </section>
  );
}

/** Удаление анкеты администратором; возвращает ошибку или null при успехе. */
function useDeleteProfile() {
  const api = useApi();
  return useCallback(
    async (userId: string): Promise<Problem | null> => {
      try {
        const { error } = await api.profile.DELETE('/v1/admin/users/{user_id}/profile', {
          params: { path: { user_id: userId } },
        });
        return error ?? null;
      } catch {
        // Запрос не дошёл до сервера: кнопка должна вернуться в исходное состояние.
        return networkProblem;
      }
    },
    [api],
  );
}

/** Удаление в два шага: сначала подтверждение, и только потом запрос. */
function DeleteButton({ onConfirm }: { onConfirm: () => Promise<Problem | null> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  if (!asking) {
    return (
      <button type="button" className="btn btn-ghost admin-danger" onClick={() => setAsking(true)}>
        Удалить
      </button>
    );
  }
  return (
    <div className="admin-confirm">
      <span className="small">Удалить анкету? Восстановить её будет нельзя.</span>
      <button
        type="button"
        className="btn admin-danger-solid"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setProblem(null);
          void onConfirm().then((failure) => {
            setBusy(false);
            if (failure) setProblem(failure);
            else setAsking(false);
          });
        }}
      >
        {busy ? 'Удаляем…' : 'Да, удалить'}
      </button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setAsking(false)}>
        Отмена
      </button>
      {problem && <ErrorMessage problem={problem} />}
    </div>
  );
}

function ProfilesPanel({
  revision,
  onEdit,
  onChanged,
}: {
  revision: number;
  onEdit: (userId: string) => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const cities = useCities();
  const removeProfile = useDeleteProfile();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const load = useCallback(
    () =>
      api.profile.GET('/v1/admin/profiles', {
        params: { query: { limit: 20, cursor, search: search || undefined } },
      }),
    [api, cursor, search],
  );
  const state = useAdminQuery<Profiles>(JSON.stringify([search, cursor, revision]), load);

  function find(event: FormEvent) {
    event.preventDefault();
    setCursor(undefined);
    setHistory([]);
    setSearch(draft.trim());
  }
  function page(direction: 'previous' | 'next', next?: string) {
    if (direction === 'next') {
      setHistory([...history, cursor]);
      setCursor(next);
    } else {
      setCursor(history.at(-1));
      setHistory(history.slice(0, -1));
    }
  }
  return (
    <section className="panel stack">
      <div className="page-head">
        <div>
          <h2>Анкеты</h2>
          <p className="muted small">Все анкеты пользователей: их можно посмотреть, изменить или удалить.</p>
        </div>
      </div>
      <form className="admin-search" onSubmit={find}>
        <label className="admin-search-field">
          <span className="small muted">Имя или идентификатор пользователя</span>
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={128}
            placeholder="Найти анкету"
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Найти
        </button>
      </form>
      {state.loading ? (
        <Loading />
      ) : state.failed ? (
        <QueryError state={state} />
      ) : state.data?.items.length === 0 ? (
        <EmptyState title="Анкеты не найдены">
          <p className="muted">Попробуйте другой запрос или создайте анкету во вкладке «Пользователи».</p>
        </EmptyState>
      ) : (
        state.data && (
          <>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Год рождения</th>
                    <th>Город</th>
                    <th>Бюджет, ₽</th>
                    <th>Заселение</th>
                    <th>Поиск</th>
                    <th>Обновлена</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((item) => (
                    <tr key={item.user_id}>
                      <td>{item.display_name}</td>
                      <td>{item.birth_year}</td>
                      <td>{cities.data?.find((city) => city.id === item.city_id)?.name ?? item.city_id}</td>
                      <td>{formatBudget(item.budget_min_rub, item.budget_max_rub)}</td>
                      <td>
                        {shortDay(item.move_in_from)} — {shortDay(item.move_in_to)}
                      </td>
                      <td>
                        {{ searching: 'Ищет', paused: 'На паузе', found: 'Сосед найден' }[item.search_status]}
                      </td>
                      <td>{date(item.updated_at)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onEdit(item.user_id)}
                          >
                            Изменить
                          </button>
                          <DeleteButton
                            onConfirm={async () => {
                              const failure = await removeProfile(item.user_id);
                              if (!failure) onChanged();
                              return failure;
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination next={state.data.next_cursor} history={history} onPage={page} />
          </>
        )
      )}
    </section>
  );
}

/** Анкета любого пользователя: просмотр, изменение, создание и удаление. */
function ProfileEditor({
  userId,
  onBack,
  onChanged,
}: {
  userId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const questionnaire = useQuestionnaire();
  const cities = useCities();
  const removeProfile = useDeleteProfile();
  const [current, setCurrent] = useState<Profile | null | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.profile
      .GET('/v1/admin/users/{user_id}/profile', { params: { path: { user_id: userId } } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (data) setCurrent(data);
        else if (error?.code === 'profile_not_found') setCurrent(null);
        else setProblem(error ?? null);
      })
      .catch(() => {
        if (!cancelled) setProblem(networkProblem);
      });
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  const back = (
    <button className="btn btn-ghost" type="button" onClick={onBack}>
      ← К списку
    </button>
  );
  if (problem)
    return (
      <section className="panel stack">
        <div className="page-head">{back}</div>
        <ErrorMessage problem={problem} />
      </section>
    );
  if (questionnaire.error !== undefined) return <ErrorMessage problem={questionnaire.error} />;
  if (cities.error !== undefined) return <ErrorMessage problem={cities.error} />;
  if (current === undefined || !questionnaire.data || !cities.data) return <Loading />;

  return (
    <section className="panel stack">
      <div className="page-head">
        <div>
          <p className="admin-eyebrow">{current ? 'АНКЕТА ПОЛЬЗОВАТЕЛЯ' : 'НОВАЯ АНКЕТА'}</p>
          <h2>{current ? current.display_name : 'Анкета для учётной записи'}</h2>
          <p className="muted small">
            Идентификатор: <code>{userId}</code>
          </p>
        </div>
        {back}
      </div>
      <ProfileForm
        initial={current}
        questionnaire={questionnaire.data}
        cities={cities.data}
        save={(body) =>
          api.profile.PUT('/v1/admin/users/{user_id}/profile', {
            params: { path: { user_id: userId } },
            body,
          })
        }
        onSaved={(saved) => {
          setCurrent(saved);
          onChanged();
        }}
        successMessage="Изменения сохранены."
      />
      {current && (
        <div className="admin-danger-zone">
          <DeleteButton
            onConfirm={async () => {
              const failure = await removeProfile(userId);
              if (!failure) {
                onChanged();
                onBack();
              }
              return failure;
            }}
          />
        </div>
      )}
    </section>
  );
}

function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="admin-eyebrow">УПРАВЛЕНИЕ ПРОЕКТОМ</p>
          <h1>Администрирование</h1>
          <p className="muted">Пользователи, данные и состояние сервисов «Сожители».</p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={() => setRevision((value) => value + 1)}>
          Обновить данные ↻
        </button>
      </div>
      {editing ? (
        <ProfileEditor
          key={editing}
          userId={editing}
          onBack={() => setEditing(null)}
          onChanged={() => setRevision((value) => value + 1)}
        />
      ) : (
        <>
          <nav className="admin-tabs" aria-label="Разделы администрирования">
            {(
              [
                { key: 'overview', title: 'Обзор' },
                { key: 'reports', title: 'Жалобы' },
                { key: 'users', title: 'Пользователи' },
                { key: 'profiles', title: 'Анкеты' },
                { key: 'databases', title: 'Базы данных' },
              ] as const
            ).map((item) => (
              <button
                type="button"
                key={item.key}
                className={`admin-tab ${tab === item.key ? 'admin-tab-active' : ''}`}
                onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? 'page' : undefined}
              >
                {item.title}
              </button>
            ))}
          </nav>
          {tab === 'overview' ? (
            <Overview revision={revision} />
          ) : tab === 'reports' ? (
            <ReportsPanel
              revision={revision}
              onEdit={setEditing}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ) : tab === 'users' ? (
            <UsersPanel revision={revision} onEdit={setEditing} />
          ) : tab === 'profiles' ? (
            <ProfilesPanel
              revision={revision}
              onEdit={setEditing}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ) : (
            <DatabasesPanel revision={revision} />
          )}
        </>
      )}
    </div>
  );
}

function AdminAccess() {
  const auth = useAuth();
  if (!auth.isAdmin)
    return (
      <EmptyState icon="🔒" title="Нужны права администратора">
        <p className="muted">
          Войдите под административной учётной записью. Обычный аккаунт не имеет доступа к этому разделу.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void auth.signOut()}>
          Выйти из текущего аккаунта
        </button>
      </EmptyState>
    );
  return <Dashboard />;
}

export default function AdminPage() {
  return (
    <main className="page">
      <RequireAuth>
        <AdminAccess />
      </RequireAuth>
    </main>
  );
}
