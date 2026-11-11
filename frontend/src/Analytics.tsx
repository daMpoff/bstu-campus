import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Group } from './api';
import { formatPoints } from './points';
import { useCabinetResource } from './useCabinetResource';
import charts from './analytics.module.css';
import s from './operations.module.css';

type RatingMonth = { monthStart: string; averageRating: number | null };
type Student = { id: number; fullName: string; academicPoints: number; publicPoints: number };
type BudgetMonth = { monthStart: string; spent: number; awards: number; academicPoints: number; publicPoints: number };
type Report = { group: Group; monthlyLimit: number; rating: RatingMonth[]; students: Student[]; budget: BudgetMonth[] };

const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonthName = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });
const month = (date: string) => monthName.format(new Date(date + 'T00:00:00Z')).replace(/ г\.$/, '');
const shortMonth = (date: string) => shortMonthName.format(new Date(date + 'T00:00:00Z')).replace(/\.$/, '');
const panel = `panel ${s.panel}`;

function ratingScale(values: number[]) {
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const step = [25, 50, 100, 125, 250].find(value => value >= (highest - lowest) / 4) ?? 250;
  const top = Math.max(step * 4, Math.ceil(highest / step) * step);
  const bottom = Math.min(top - 4 * step, Math.floor(lowest / step) * step);
  const ticks = Array.from({ length: (top - bottom) / step + 1 }, (_, index) => top - index * step);
  return { ticks, position: (value: number) => (top - value) / (top - bottom) * 100 };
}

function RatingChart({ data, values }: { data: RatingMonth[]; values: number[] }) {
  const [selected, setSelected] = useState(data.length - 1);
  const [hovered, setHovered] = useState<number>();
  const activeIndex = hovered ?? selected;
  const current = data[activeIndex];
  const { ticks, position } = ratingScale(values);
  const x = (index: number) => data.length === 1 ? 50 : index / (data.length - 1) * 100;
  const points = data.map(({ averageRating }, index) => averageRating === null
    ? null : { x: x(index), y: position(averageRating) });
  const line = points.map((point, index) => point
    ? `${points[index - 1] ? 'L' : 'M'}${point.x} ${point.y}` : '').join(' ');
  const area = data.length > 1 && points.every(Boolean)
    ? `M0 100 ${line.replace(/^M/, 'L')} L100 100 Z` : undefined;

  return <>
    <div className={charts.readout}>
      <div className={charts.readoutValue}>
        <time dateTime={current.monthStart}>{month(current.monthStart)}</time>
        <output aria-label="Средний АР за выбранный месяц">
          <strong>{current.averageRating === null ? '—' : formatPoints(current.averageRating)}</strong>
          {current.averageRating !== null && <>{' '}<span>АР</span></>}
        </output>
      </div>
      <label>Месяц на графике
        <select value={selected} onChange={event => { setHovered(undefined); setSelected(Number(event.target.value)); }}>
          {data.map(({ monthStart, averageRating }, index) => <option key={monthStart} value={index}>
            {month(monthStart)}{averageRating === null ? ' · нет данных' : ` · ${formatPoints(averageRating)} АР`}
          </option>)}
        </select>
      </label>
    </div>
    <div className={charts.trend} aria-hidden="true">
      <div className={charts.scale}>
        {ticks.map(tick => <span key={tick} style={{ top: `${position(tick)}%` }}>{formatPoints(tick)}</span>)}
      </div>
      <div className={charts.plot}>
        <div className={charts.plotArea} onPointerMove={event => {
          if (event.pointerType === 'touch') return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const index = Math.round((event.clientX - bounds.left) / bounds.width * (data.length - 1));
          setHovered(Math.max(0, Math.min(data.length - 1, index)));
        }} onPointerLeave={() => setHovered(undefined)}>
          {ticks.map(tick => <span key={tick} className={charts.gridline} style={{ top: `${position(tick)}%` }} />)}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
            {area && <path className={charts.area} d={area} />}
            <path className={charts.line} d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          <span className={charts.guide} style={{ left: `${x(activeIndex)}%` }} />
          {points.map((point, index) => point && <span key={data[index].monthStart} className={charts.point}
            data-active={index === activeIndex} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
        </div>
        <div className={charts.months}>
          {data.map(({ monthStart }, index) => <span key={monthStart} style={{ left: `${x(index)}%` }}
            data-minor={data.length > 6 && index !== 0 && index !== data.length - 1 && index % 3 !== 0}
            data-compact={data.length > 3 && index !== data.length - 1 && index % 2 !== 0}
            data-active={index === activeIndex}>{shortMonth(monthStart)}</span>)}
        </div>
      </div>
    </div>
    <details className={charts.values}>
      <summary>Помесячные значения</summary>
      <table>
        <thead><tr><th scope="col">Месяц</th><th scope="col">Средний АР</th></tr></thead>
        <tbody>{data.map(({ monthStart, averageRating }) => <tr key={monthStart}>
          <th scope="row"><time dateTime={monthStart}>{month(monthStart)}</time></th>
          <td>{averageRating === null ? '—' : formatPoints(averageRating)}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </>;
}

function RatingTrend({ data }: { data: RatingMonth[] }) {
  const values = data.flatMap(item => item.averageRating === null ? [] : [item.averageRating]);
  return <section className={panel} aria-labelledby="rating-trend">
    <h2 id="rating-trend">Динамика академического рейтинга</h2>
    <p className="muted">Средний АР текущего состава на конец каждого месяца. За текущий месяц показан АР на сегодня.</p>
    {values.length ? <RatingChart data={data} values={values} /> : <p className="muted">В группе пока нет студентов.</p>}
  </section>;
}

function ActivityRanking({ students }: { students: Student[] }) {
  const [sort, setSort] = useState<'academicPoints' | 'publicPoints'>('academicPoints');
  const ranked = [...students].sort((a, b) => b[sort] - a[sort] || a.fullName.localeCompare(b.fullName, 'ru') || a.id - b.id);
  return <section className={panel} aria-labelledby="activity-ranking">
    <h2 id="activity-ranking">Рейтинг активности</h2>
    <div className={s.switcher} role="group" aria-label="Сортировка по баллам">
      <button className="button outline" type="button" aria-pressed={sort === 'academicPoints'} onClick={() => setSort('academicPoints')}>По БУА</button>
      <button className="button outline" type="button" aria-pressed={sort === 'publicPoints'} onClick={() => setSort('publicPoints')}>По БОА</button>
    </div>
    {ranked.length ? <ol className={s.rows}>{ranked.map((student, index) => <li key={student.id} className={s.row}>
      <div className={s.rankedText}><span className={s.rank} aria-hidden="true">{index + 1}</span>
        <Link to={`/profiles/${student.id}`}>{student.fullName}</Link></div>
      <div className={s.numbers}>
        <span><strong>{formatPoints(student.academicPoints)}</strong> БУА</span>
        <span><strong>{formatPoints(student.publicPoints)}</strong> БОА</span>
      </div>
    </li>)}</ol> : <p className="muted">В группе пока нет студентов.</p>}
  </section>;
}

function Budget({ months, limit }: { months: BudgetMonth[]; limit: number }) {
  const remaining = Math.max(0, limit - (months[0]?.spent ?? 0));
  const maxPoints = Math.max(0, ...months.map(row => row.academicPoints + row.publicPoints));
  return <section className={panel} aria-labelledby="budget-history">
    <h2 id="budget-history">Ваш бюджет и начисления</h2>
    <div className={charts.budgetSummary}>
      <p className={s.stat}><strong>{formatPoints(remaining)}</strong><span>баллов доступно в этом месяце из {formatPoints(limit)}</span></p>
      <span className={charts.track} aria-hidden="true"><span className={charts.academic}
        style={{ width: `${limit > 0 ? remaining / limit * 100 : 0}%` }} /></span>
    </div>
    {maxPoints > 0 && <div className={charts.legend} aria-hidden="true">
      <span><i className={charts.academic} /> БУА</span>
      <span><i className={charts.public} /> БОА</span>
      <span className={charts.budgetScale}>0–{formatPoints(maxPoints)} баллов</span>
    </div>}
    <ul className={s.rows}>{months.map(row => <li className={charts.budgetMonth} key={row.monthStart}>
      <div className={charts.budgetMonthHead}>
        <time dateTime={row.monthStart}><strong>{month(row.monthStart)}</strong></time>
        <span>Расход <strong>{formatPoints(row.spent)}</strong></span>
      </div>
      {maxPoints > 0 && <span className={charts.track} aria-hidden="true">
        <span className={charts.academic} style={{ width: `${row.academicPoints / maxPoints * 100}%` }} />
        <span className={charts.public} style={{ width: `${row.publicPoints / maxPoints * 100}%` }} />
      </span>}
      <div className={`${s.numbers} ${charts.budgetMonthDetails}`}>
        <span>{formatPoints(row.academicPoints)} БУА</span>
        <span>{formatPoints(row.publicPoints)} БОА</span>
        <span>Начислений <strong>{row.awards}</strong></span>
      </div>
    </li>)}</ul>
  </section>;
}

function GroupReport({ groupId, months }: { groupId: number; months: number }) {
  const { data, error } = useCabinetResource<Report>(`/teacher/analytics?groupId=${groupId}&months=${months}`);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted" role="status">Загружаем аналитику…</p>;
  return <>
    <RatingTrend data={data.rating} />
    <ActivityRanking students={data.students} />
    <Budget months={data.budget} limit={data.monthlyLimit} />
  </>;
}

export function Analytics() {
  const { data: groups, error } = useCabinetResource<Group[]>('/teacher/groups');
  const [selected, setSelected] = useState<number>();
  const [months, setMonths] = useState(6);
  const groupId = selected ?? groups?.[0]?.id;
  return <div className={s.page}>
    <h1>Аналитика группы</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {!groups && !error && <p className="muted" role="status">Загружаем группы…</p>}
    {groups?.length === 0 && <p className={panel}>Учебных групп пока нет.</p>}
    {!!groups?.length && <div className={`panel ${s.controls}`}>
      <label>Учебная группа<select value={groupId} onChange={event => setSelected(Number(event.target.value))}>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
      <label>Период отчёта<select value={months} onChange={event => setMonths(Number(event.target.value))}>
        <option value={3}>3 месяца</option><option value={6}>6 месяцев</option><option value={12}>12 месяцев</option>
      </select></label>
    </div>}
    {groupId !== undefined && <GroupReport key={`${groupId}-${months}`} groupId={groupId} months={months} />}
  </div>;
}
