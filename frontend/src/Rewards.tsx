import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RewardPage } from './api';
import { dateTime } from './Assignments';
import { activityPointLabel, formatPoints } from './points';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import s from './rewards.module.css';

export function Rewards() {
  const { data, error } = useCabinetResource<RewardPage>('/rewards');
  const [older, setOlder] = useState<RewardPage>();
  const [busy, setBusy] = useState(false);
  const [olderError, setOlderError] = useState('');
  const entries = [...(data?.entries ?? []), ...(older?.entries ?? [])];
  const next = older ? older.nextBeforeId : data?.nextBeforeId;

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
    {data && <section className={`panel ${cabinet.section}`} aria-label="Начисления за активности">
      {entries.length ? <ul className={s.list}>{entries.map(entry => <li key={entry.id} className={s.row}>
        <div>
          <Link to={`/profiles/${entry.studentId}`} className={s.student}>{entry.studentName}</Link>
          <p className={s.activity}>{entry.activityTitle}</p>
          <time className={s.time} dateTime={entry.awardedAt}>{dateTime(entry.awardedAt)} МСК</time>
        </div>
        <strong className={s.points}>+{formatPoints(entry.points)} {activityPointLabel(entry.kind)}</strong>
      </li>)}</ul> : <p className="muted">Начислений пока нет.</p>}
      {olderError && <p className="error" role="alert">{olderError}</p>}
      {next && <button className={`button outline ${s.more}`} type="button" disabled={busy} onClick={() => void loadMore()}>
        {busy ? 'Загружаем…' : 'Показать ещё'}
      </button>}
    </section>}
  </>;
}
