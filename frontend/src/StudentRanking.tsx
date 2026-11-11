import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatPoints, pointLabels } from './points';
import { useCabinetResource } from './useCabinetResource';
import s from './student-ranking.module.css';

const metrics = {
  AR: 'Академический рейтинг (АР)',
  BUA: 'Учебная активность (БУА)',
  BOA: 'Общественная активность (БОА)',
};
type Metric = keyof typeof metrics;
type Catalog = {
  faculties: { id: number; name: string }[];
  groups: { id: number; name: string; facultyId: number | null }[];
};
type Entry = { studentId: number; fullName: string; groupName: string; place: number | null; points: number };
type Ranking = {
  leaders: { student: Entry; tiedStudents: number }[];
  entries: Entry[];
  viewer: Entry | null;
  page: number;
  pageSize: number;
  total: number;
};

function numericParam(value: string | null, max = Number.MAX_SAFE_INTEGER) {
  return value && /^[1-9][0-9]*$/.test(value) && Number(value) <= max ? value : '';
}

export function StudentRanking() {
  const [params, setParams] = useSearchParams();
  const focusAfterPagination = useRef(false);
  const { data: catalog, error, reload } = useCabinetResource<Catalog>('/student/ranking/catalog');
  const rawMetric = params.get('metric');
  const metric: Metric = rawMetric === 'BUA' || rawMetric === 'BOA' ? rawMetric : 'AR';
  const faculty = numericParam(params.get('facultyId'));
  const group = numericParam(params.get('groupId'));
  const page = numericParam(params.get('page'), 2_147_483_647) || '1';
  const groups = catalog?.groups.filter(option => !faculty || String(option.facultyId) === faculty) ?? [];
  const query = new URLSearchParams({ metric, page });
  if (faculty) query.set('facultyId', faculty);
  if (group) query.set('groupId', group);

  function updateFilter(name: string, value: string) {
    focusAfterPagination.current = false;
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === 'facultyId') next.delete('groupId');
    next.delete('page');
    setParams(next);
  }

  function updatePage(nextPage: number) {
    focusAfterPagination.current = true;
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next);
  }

  function focusTable(node: HTMLHeadingElement | null) {
    if (node && focusAfterPagination.current) {
      focusAfterPagination.current = false;
      node.focus();
    }
  }

  return <section className={s.ranking} aria-labelledby="student-ranking-title">
    <div className={`panel ${s.filterPanel}`}>
      <h2 id="student-ranking-title">Рейтинг студентов</h2>
      <div className={s.filters}>
        <label>Показатель
          <select value={metric} onChange={event => updateFilter('metric', event.target.value)}>
            {Object.entries(metrics).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Факультет или институт
          <select value={faculty} onChange={event => updateFilter('facultyId', event.target.value)} disabled={!catalog}>
            <option value="">Все подразделения</option>
            {catalog?.faculties.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label>Учебная группа
          <select value={group} onChange={event => updateFilter('groupId', event.target.value)} disabled={!catalog}>
            <option value="">Все группы</option>
            {groups.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      </div>
      {error && <div className={s.error}>
        <p className="error" role="alert">Не удалось загрузить подразделения и группы. {error}</p>
        <button type="button" className="button outline" onClick={reload}>Повторить</button>
      </div>}
    </div>
    <RankingResults key={query.toString()} path={`/student/ranking?${query}`} metric={metric}
      updatePage={updatePage} focusTable={focusTable} />
  </section>;
}

function RankingResults({ path, metric, updatePage, focusTable }: {
  path: string; metric: Metric; updatePage: (page: number) => void; focusTable: (node: HTMLHeadingElement | null) => void;
}) {
  const { data, error, reload } = useCabinetResource<Ranking>(path);
  if (error) return <div className={`panel ${s.error}`}>
    <p className="error" role="alert">{error}</p>
    <button type="button" className="button outline" onClick={reload}>Повторить</button>
  </div>;
  if (!data) return <p className={`panel muted ${s.placeholder}`} role="status">Загружаем рейтинг…</p>;
  if (!data.total) return <p className={`panel muted ${s.placeholder}`} role="status">По этим фильтрам нет участников.</p>;

  const pointsUnit = pointLabels[metric];
  const lastPage = Math.ceil(data.total / data.pageSize);
  return <>
    <section className={`panel ${s.podiumPanel}`} aria-labelledby="student-podium-title">
      <div className={s.sectionHead}>
        <h3 id="student-podium-title">Пьедестал</h3>
        {data.viewer && <p className={s.viewerPlace} role="status">
          {data.viewer.place === null ? `У вас пока нет начислений ${pointsUnit}` : `Ваше место · ${data.viewer.place}`}
        </p>}
      </div>
      {data.leaders.length === 0 ? <p className="muted">Пока нет начислений {pointsUnit}.</p> :
        <ol className={s.podium} role="list" aria-label="Первые три места">
          {[1, 2, 3].map(place => {
            const leader = data.leaders.find(item => item.student.place === place);
            return <li key={place} className={s.podiumCard} data-place={place}>
              <span className={s.medal} aria-hidden="true">{place}</span>
              <div className={s.podiumDetails}>
                <small className={s.place}>{place}-е место</small>
                {leader ? <>
                  <strong className={s.leaderName}>{leader.student.fullName}</strong>
                  <span className={s.group}>{leader.student.groupName}</span>
                  {leader.tiedStudents > 1 && <span className={s.tie}>Ещё {leader.tiedStudents - 1} с тем же результатом</span>}
                </> : <span className={s.group}>Нет участника</span>}
              </div>
              {leader && <div className={s.podiumScore}>{formatPoints(leader.student.points)} <small>{pointsUnit}</small></div>}
            </li>;
          })}
        </ol>}
    </section>
    <section className={`panel ${s.resultsPanel}`} aria-labelledby="student-results-title">
      <div className={s.sectionHead}>
        <h3 id="student-results-title" ref={focusTable} tabIndex={-1}>Все участники</h3>
        <p className="muted" role="status">Всего · {formatPoints(data.total)}</p>
      </div>
      <table className={s.table} aria-labelledby="student-results-title">
        <thead><tr><th scope="col">Место</th><th scope="col">Студент и группа</th><th scope="col">{pointsUnit}</th></tr></thead>
        <tbody>{data.entries.map(entry => <tr key={entry.studentId} data-viewer={entry.studentId === data.viewer?.studentId}>
          <td>{entry.place ?? '—'}</td>
          <td>
            <Link className={s.studentLink} to={`/profiles/${entry.studentId}`}>{entry.fullName}</Link>
            <span className={s.group}>{entry.groupName}{entry.studentId === data.viewer?.studentId && ' · Вы'}</span>
          </td>
          <td>{formatPoints(entry.points)}</td>
        </tr>)}</tbody>
      </table>
      {lastPage > 1 && <nav className={s.pagination} aria-label="Страницы рейтинга">
        <button className="button outline" type="button" disabled={data.page === 1} onClick={() => updatePage(data.page - 1)}>Назад</button>
        <p>Страница {data.page} из {lastPage}</p>
        <button className="button outline" type="button" disabled={data.page === lastPage} onClick={() => updatePage(data.page + 1)}>Вперёд</button>
      </nav>}
    </section>
  </>;
}
