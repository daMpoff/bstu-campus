import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { dateTime } from './Assignments';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import s from './personal-feed.module.css';

const icons = {
  ASSIGNMENT_CREATED: 'M9 5H6a2 2 0 0 0-2 2v13h16V7a2 2 0 0 0-2-2h-3M9 3h6v4H9zM12 10v7m-3-3.5h6',
  ASSIGNMENT_DUE: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
  ASSIGNMENT_MATERIAL_ADDED: 'M5 4h9l5 5v11H5zM14 4v5h5M8 13h8M8 16h5',
  WORK_ACCEPTED: 'M20 7 10 17l-5-5',
  WORK_RETURNED: 'm9 10-5 5 5 5m-5-5h11a5 5 0 0 0 0-10h-3',
  WORK_SUBMITTED: 'M5 4h9l5 5v11H5zM14 4v5h5M8 13h8M8 16h5',
  ACTIVITY_AWARDED: 'm12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.1-5.6-2.9-5.6 2.9 1.1-6.1L3 9.5l6.2-.9z',
  ACTIVITY_CREATED: 'M4 6h16v14H4zM8 3v6m8-6v6M4 11h16m-8 2v5m-2.5-2.5h5',
  POLL_CREATED: 'M5 20V4h14v16zM9 8h6M9 12h6M9 16h3',
  POLL_ENDED: 'M4 20h16M7 16v-5m5 5V7m5 9V4',
};

type Event = {
  id: number; eventType: keyof typeof icons; occurredAt: string; title: string; details: string; linkPath: string;
};
type FeedPage = { entries: Event[]; nextBeforeId: number | null };

export function PersonalFeed() {
  const [firstPage, setFirstPage] = useState<FeedPage>();
  const [older, setOlder] = useState<FeedPage>();
  const { data, error, reload } = useCabinetResource<FeedPage>('/feed', firstPage ? 0 : 6000);
  const [busy, setBusy] = useState(false);
  const [olderError, setOlderError] = useState('');
  const current = firstPage ?? data;
  const next = older ? older.nextBeforeId : current?.nextBeforeId;
  const entries = [...(current?.entries ?? []), ...(older?.entries ?? [])];

  async function loadMore() {
    if (!next || busy || !current) return;
    setFirstPage(current);
    setBusy(true);
    setOlderError('');
    try {
      const page = await api<FeedPage>(`/feed?beforeId=${next}`);
      setOlder(previous => ({ entries: [...(previous?.entries ?? []), ...page.entries], nextBeforeId: page.nextBeforeId }));
    } catch (failure) {
      setOlderError(failure instanceof Error ? failure.message : 'Не удалось загрузить события.');
    } finally {
      setBusy(false);
    }
  }

  function refresh() {
    setFirstPage(undefined);
    setOlder(undefined);
    setOlderError('');
    reload();
  }

  return <>
    <div className={s.heading}>
      <h1>Персональная лента</h1>
      <button className="button outline" type="button" disabled={busy} onClick={refresh}>Обновить</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!current && !error && <p className="muted" role="status">Загружаем события…</p>}
    {current && <section className={`panel ${cabinet.section}`} aria-label="События в ленте">
      {entries.length === 0 ? <p className="muted">Событий пока нет.</p> : <ul className={s.events}>
        {entries.map(event => <li className={s.event} key={event.id}>
          <span className={s.icon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icons[event.eventType]} /></svg></span>
          <div>
            <h2><Link to={event.linkPath}>{event.title}</Link></h2>
            <p>{event.details}</p>
          </div>
          <time dateTime={event.occurredAt}>{dateTime(event.occurredAt)} МСК</time>
        </li>)}
      </ul>}
      {olderError && <p className="error" role="alert">{olderError}</p>}
      {next && <button className={`button outline ${s.more}`} type="button" disabled={busy}
        onClick={() => void loadMore()}>{busy ? 'Загружаем…' : 'Показать ещё'}</button>}
    </section>}
  </>;
}
