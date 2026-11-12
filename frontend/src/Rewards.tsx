import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Reward, type RewardPage } from './api';
import { dateTime } from './Assignments';
import { activityPointLabel, formatPoints } from './points';
import { useCabinetResource } from './useCabinetResource';
import s from './rewards.module.css';

const dateParts = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
});
const rewardKinds = {
  ACADEMIC: { label: 'Учебная', icon: 'M12 6.5C9 4.5 5 4 2.5 5.5v13c3-1.5 6.5-1 9.5 1 3-2 6.5-2.5 9.5-1v-13c-2.5-1.5-6.5-1-9.5 1Zm0 0v13' },
  PUBLIC: { label: 'Общественная', icon: 'M14 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2M17 5a3 3 0 0 1 0 6m2 2a4 4 0 0 1 3 4v3' },
};

function RewardRow({ entry, currentYear }: { entry: Reward; currentYear?: string }) {
  const { day, month, year, hour, minute } = Object.fromEntries(
    dateParts.formatToParts(new Date(entry.awardedAt)).map(part => [part.type, part.value]),
  );
  const kind = rewardKinds[entry.kind];

  return <li className={s.row}>
    <time className={s.time} dateTime={entry.awardedAt} title={`${dateTime(entry.awardedAt)} МСК`}>
      <span className={s.date}>{day} {month}{year !== currentYear && <small> {year}</small>}</span>{' '}
      <span className={s.clock}>{hour}:{minute} МСК</span>
    </time>
    <div className={`panel ${s.card}`}>
      <div className={s.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
          <path d={kind.icon} />
        </svg>
      </div>
      <div className={s.details}>
        <p className={s.kind}>{kind.label}</p>
        <h2 className={s.activity}>{entry.activityTitle}</h2>
        <Link to={`/profiles/${entry.studentId}`} className={s.student}>{entry.studentName}</Link>
      </div>
      <strong className={s.points}>+{formatPoints(entry.points)} {activityPointLabel(entry.kind)}</strong>
    </div>
  </li>;
}

export function Rewards() {
  const { data, error } = useCabinetResource<RewardPage>('/rewards');
  const [older, setOlder] = useState<RewardPage>();
  const [busy, setBusy] = useState(false);
  const [olderError, setOlderError] = useState('');
  const entries = [...(data?.entries ?? []), ...(older?.entries ?? [])];
  const next = older ? older.nextBeforeId : data?.nextBeforeId;
  const currentYear = dateParts.formatToParts(Date.now()).find(part => part.type === 'year')?.value;

  async function loadMore() {
    if (!next || busy) return;
    setBusy(true);
    setOlderError('');
    try {
      const page = await api<RewardPage>(`/rewards?beforeId=${next}`);
      setOlder(previous => ({ entries: [...(previous?.entries ?? []), ...page.entries], nextBeforeId: page.nextBeforeId }));
    } catch (failure) {
      setOlderError(failure instanceof Error ? failure.message : 'Не удалось загрузить начисления.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <h1 className={s.heading}>Лента наград</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем начисления…</p>}
    {data && <section className={s.timeline} aria-label="Начисления за активности">
      {entries.length ? <ul className={s.list} role="list">
        {entries.map(entry => <RewardRow key={entry.id} entry={entry} currentYear={currentYear} />)}
      </ul> : <p className={`panel muted ${s.empty}`}>Начислений пока нет.</p>}
      {olderError && <p className="error" role="alert">{olderError}</p>}
      {next && <button className={`button outline ${s.more}`} type="button" disabled={busy} onClick={() => void loadMore()}>
        {busy ? 'Загружаем…' : 'Показать ещё'}
      </button>}
    </section>}
  </>;
}
