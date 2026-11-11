import { Link } from 'react-router-dom';
import { dateTime, StatusBadge } from './Assignments';
import type { AssistantDeadline, StudentAssistantResult } from './studentAssistant';
import s from './assistant.module.css';

const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const points = new Intl.NumberFormat('ru-RU', { signDisplay: 'exceptZero' });

function DeadlineList({ items, total, onNavigate }: { items: AssistantDeadline[]; total: number; onNavigate: () => void }) {
  return <>
    <ul className={s.summaryList}>
      {items.map(item => <li key={item.id}>
        <Link className={s.deadlineLink} to={`/assignments/${item.id}`} onClick={onNavigate}>
          <strong>{item.title}</strong>
          <span className={s.summaryDetails}>
            <time dateTime={item.deadline}>{dateTime(item.deadline)} МСК</time>
            <StatusBadge status={item.status} />
            <span>Списано {item.deducted} АР</span>
          </span>
        </Link>
      </li>)}
    </ul>
    {total > items.length && <p className={s.summaryHint}>Показано {items.length} из {total}.</p>}
  </>;
}

export function StudentAssistantSummary({ data, onNavigate }: { data: StudentAssistantResult; onNavigate: () => void }) {
  const { period, rating, assignments, overdue, ratingHistory, assignmentsTotal, overdueTotal } = data;
  return <section className={s.summary} aria-label="Мои дедлайны и рейтинг">
    <h3>Мои дедлайны и рейтинг</h3>
    <p className={s.summaryRating}>Академический рейтинг <strong>{rating} из 1000 АР</strong></p>
    <div className={s.summaryGroup}>
      <h4>Задания с {date.format(new Date(period.startDate))} по {date.format(new Date(period.endDate))}</h4>
      {assignments.length ? <DeadlineList items={assignments} total={assignmentsTotal} onNavigate={onNavigate} />
        : <p className={s.summaryHint}>На эти даты заданий нет.</p>}
    </div>
    {overdue.length > 0 && <div className={s.summaryGroup}>
      <h4>Просроченные задания до этого периода</h4>
      <DeadlineList items={overdue} total={overdueTotal} onNavigate={onNavigate} />
    </div>}
    {ratingHistory.length > 0 && <div className={s.summaryGroup}>
      <h4>Последние изменения АР</h4>
      <ul className={s.summaryList}>
        {ratingHistory.map((item, index) => <li className={s.ratingChange} key={`${item.recordedAt}:${index}`}>
          <span><strong>{points.format(item.amount)} АР</strong> · {item.assignmentTitle ?? (item.semesterStart ? 'Пополнение за семестр' : 'Изменение рейтинга')}</span>
          <time className={s.summaryHint} dateTime={item.recordedAt}>{dateTime(item.recordedAt)} МСК</time>
        </li>)}
      </ul>
    </div>}
    <Link className={s.result} to="/assignments" onClick={onNavigate}>Все задания →</Link>
  </section>;
}
