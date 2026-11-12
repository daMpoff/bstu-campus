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
type Leader = { student: Entry; tiedStudents: number; displayStudents: Entry[] };
type Ranking = {
  leaders: Leader[];
  entries: Entry[];
  viewer: Entry | null;
  page: number;
  pageSize: number;
  total: number;
};
const maxAcademicRating = 1000;
const participantCount = new Intl.PluralRules('ru-RU');

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
    <div className={s.filterPanel}>
      <h1 className={s.pageTitle} id="student-ranking-title">Рейтинг студентов</h1>
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

function PersonalResult({ viewer, leader, metric }: { viewer: Entry; leader?: Leader; metric: Metric }) {
  const unit = pointLabels[metric];
  const maximum = metric === 'AR' ? maxAcademicRating : leader?.student.points;

  return <div className={s.summaryTop}>
    <section className={s.personalCard} data-ranked={viewer.place !== null} aria-labelledby="personal-ranking-title">
      <h2 id="personal-ranking-title">Ваш результат</h2>
      <p className={s.personalPlace}>{viewer.place === null ? 'Место пока не определено' : `${formatPoints(viewer.place)}-е место`}</p>
      <p className={s.personalPoints}><strong>{formatPoints(viewer.points)}</strong>{metric === 'AR' && ` / ${formatPoints(maxAcademicRating)}`} {unit}</p>
    </section>
    {leader && maximum !== undefined && <section className={s.comparison} aria-labelledby="ranking-comparison-title">
      <div className={s.comparisonHead}>
        <h2 id="ranking-comparison-title">Сравнение с лидерами</h2>
        <p className={s.difference}>
          {viewer.place === 1
            ? leader.tiedStudents > 1 ? 'Вы делите первое место' : 'Вы на первом месте'
            : `Разница ${formatPoints(leader.student.points - viewer.points)} ${unit}`}
        </p>
      </div>
      <ComparisonScore label="Ваш результат" points={viewer.points} maximum={maximum} unit={unit} viewer />
      <ComparisonScore label="Первое место" points={leader.student.points} maximum={maximum} unit={unit} />
    </section>}
  </div>;
}

function ComparisonScore({ label, points, maximum, unit, viewer = false }: {
  label: string; points: number; maximum: number; unit: string; viewer?: boolean;
}) {
  return <div className={s.comparisonRow}>
    <p className={s.comparisonLabel}><span>{label}</span><b>{formatPoints(points)} {unit}</b></p>
    <meter aria-label={label} min={0} max={maximum} value={points} data-viewer={viewer} />
  </div>;
}

function Podium({ leaders, unit }: { leaders: Leader[]; unit: string }) {
  return <section className={s.podiumStrip} aria-labelledby="student-podium-title">
    <h2 id="student-podium-title">Первые три места</h2>
    {leaders.length === 0 ? <p className="muted">Пока нет начислений {unit}.</p> :
      <ol className={s.podium} role="list" aria-labelledby="student-podium-title">
        {[1, 2, 3].map(place => {
          const leader = leaders.find(item => item.student.place === place);
          const students = leader?.displayStudents ?? (leader ? [leader.student] : []);
          const remaining = leader ? leader.tiedStudents - students.length : 0;
          return <li key={place} className={s.podiumEntry} data-place={place}>
            <span className={s.medal} aria-hidden="true">{place}</span>
            <div className={s.podiumDetails}>
              <div className={s.podiumMeta}>
                <strong className={s.place}>{place}-е место</strong>
                {leader && <span className={s.podiumScore}>{formatPoints(leader.student.points)} {unit}</span>}
              </div>
              {leader ? <div className={s.podiumNames}>
                {students.map((student, index) => <span key={student.studentId}>
                  {index > 0 && <span aria-hidden="true"> · </span>}
                  <Link className={s.studentLink} to={`/profiles/${student.studentId}`}>{student.fullName}</Link>
                </span>)}
                {remaining > 0 && <span className={s.tie}>Ещё {formatPoints(remaining)} с тем же результатом</span>}
              </div> : <span className={s.group}>Нет участника</span>}
            </div>
          </li>;
        })}
      </ol>}
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
  const leader = data.leaders.find(item => item.student.place === 1);
  const lastPage = Math.ceil(data.total / data.pageSize);
  const totalLabel = participantCount.select(data.total);
  return <>
    <div className={`panel ${s.summaryPanel}`}>
      {data.viewer && <PersonalResult viewer={data.viewer} leader={leader} metric={metric} />}
      <Podium leaders={data.leaders} unit={pointsUnit} />
    </div>
    <section className={`panel ${s.resultsPanel}`} aria-labelledby="student-results-title">
      <div className={s.sectionHead}>
        <h2 id="student-results-title" ref={focusTable} tabIndex={-1}>Все участники</h2>
        <p className="muted" role="status">{formatPoints(data.total)} {totalLabel === 'one' ? 'участник' : totalLabel === 'few' ? 'участника' : 'участников'}</p>
      </div>
      <table className={s.table} aria-labelledby="student-results-title">
        <thead><tr><th scope="col">Место</th><th scope="col">Студент и группа</th><th scope="col">{pointsUnit}</th></tr></thead>
        <tbody>{data.entries.map(entry => <tr key={entry.studentId} data-viewer={entry.studentId === data.viewer?.studentId}>
          <td>{entry.place !== null && entry.place <= 3
            ? <span className={s.medal} data-place={entry.place}>{entry.place}</span>
            : entry.place ?? '—'}</td>
          <td>
            <Link className={s.studentLink} to={`/profiles/${entry.studentId}`}>{entry.fullName}</Link>
            {entry.studentId === data.viewer?.studentId && <span className={s.you}>Вы</span>}
            <span className={s.group}>{entry.groupName}</span>
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
