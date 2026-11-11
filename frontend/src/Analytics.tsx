import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Group } from './api';
import { formatPoints } from './points';
import { useCabinetResource } from './useCabinetResource';
import s from './operations.module.css';

type RatingMonth = { monthStart: string; averageRating: number | null };
type Student = { id: number; fullName: string; academicPoints: number; publicPoints: number };
type BudgetMonth = { monthStart: string; spent: number; awards: number; academicPoints: number; publicPoints: number };
type Report = { group: Group; monthlyLimit: number; rating: RatingMonth[]; students: Student[]; budget: BudgetMonth[] };

const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const month = (date: string) => monthName.format(new Date(date + 'T00:00:00Z'));
const panel = `panel ${s.panel}`;

function RatingTrend({ data }: { data: RatingMonth[] }) {
  return <section className={panel} aria-labelledby="rating-trend">
    <h2 id="rating-trend">Динамика академического рейтинга</h2>
    <p className="muted">Средний АР текущего состава на конец каждого месяца. За текущий месяц показан АР на сегодня.</p>
    {data.every(item => item.averageRating === null) ? <p className="muted">В группе пока нет студентов.</p> : <ol className={s.chart}>
      {data.map(({ monthStart, averageRating }) => <li key={monthStart} className={s.chartRow}>
        <time dateTime={monthStart}>{month(monthStart)}</time>
        <span className={s.track} aria-hidden="true"><span className={s.bar} style={{ width: `${(averageRating ?? 0) / 10}%` }} /></span>
        <strong>{averageRating === null ? '—' : formatPoints(averageRating)}</strong>
      </li>)}
    </ol>}
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
  const spent = months[0]?.spent ?? 0;
  return <section className={panel} aria-labelledby="budget-history">
    <h2 id="budget-history">Ваш бюджет и начисления</h2>
    <p className={s.stat}><strong>{formatPoints(Math.max(0, limit - spent))}</strong><span>баллов доступно в этом месяце из {formatPoints(limit)}</span></p>
    <ul className={s.rows}>{months.map(row => <li className={s.row} key={row.monthStart}>
      <time dateTime={row.monthStart}><strong>{month(row.monthStart)}</strong></time>
      <div className={`${s.numbers} ${s.budgetNumbers}`}>
        <span>Расход <strong>{formatPoints(row.spent)}</strong></span>
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
