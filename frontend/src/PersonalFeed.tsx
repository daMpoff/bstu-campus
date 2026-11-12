import { useEffect, useRef, useState } from 'react';
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
type FeedAction = { type: 'older'; beforeId: number } | { type: 'newer'; latest: FeedPage };

async function mergeRecent(current: FeedPage, latest: FeedPage, signal: AbortSignal): Promise<FeedPage> {
  const known = new Set(current.entries.map(event => event.id));
  const recent: Event[] = [];
  let page = latest;
  for (;;) {
    recent.push(...page.entries);
    if (page.nextBeforeId === null || page.entries.some(event => known.has(event.id))) break;
    // The newest page may have moved beyond all the loaded rows during a burst of events.
    page = await api<FeedPage>(`/feed?beforeId=${page.nextBeforeId}`, { signal });
  }
  const entries = new Map(recent.map(event => [event.id, event]));
  for (const event of current.entries) {
    if (!entries.has(event.id)) entries.set(event.id, event);
  }
  return { entries: [...entries.values()], nextBeforeId: current.nextBeforeId };
}

export function PersonalFeed() {
  const [snapshot, setSnapshot] = useState<FeedPage>();
  const { data, error, reload } = useCabinetResource<FeedPage>('/feed', 6000);
  const [busy, setBusy] = useState<FeedAction['type']>();
  const [loadError, setLoadError] = useState<{ type: FeedAction['type']; message: string }>();
  const activeRequest = useRef<AbortController>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = snapshot ?? data;
  const knownIds = snapshot && new Set(snapshot.entries.map(event => event.id));
  const hasNew = !!knownIds && !!data?.entries.some(event => !knownIds.has(event.id));

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function load(action: FeedAction) {
    if (!current || activeRequest.current) return;
    const request = new AbortController();
    activeRequest.current = request;
    setSnapshot(current);
    setBusy(action.type);
    setLoadError(undefined);
    try {
      if (action.type === 'older') {
        const page = await api<FeedPage>(`/feed?beforeId=${action.beforeId}`, { signal: request.signal });
        if (request.signal.aborted) return;
        setSnapshot({ entries: [...current.entries, ...page.entries], nextBeforeId: page.nextBeforeId });
      } else {
        const updated = await mergeRecent(current, action.latest, request.signal);
        if (request.signal.aborted) return;
        setSnapshot(updated);
        heading.current?.focus({ preventScroll: true });
        heading.current?.scrollIntoView({ block: 'start' });
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        setSnapshot(snapshot);
        setLoadError({ type: action.type, message: failure instanceof Error ? failure.message : 'Не удалось загрузить события.' });
      }
    } finally {
      activeRequest.current = null;
      if (!request.signal.aborted) setBusy(undefined);
    }
  }

  return <>
    <h1 className={s.heading} ref={heading} tabIndex={-1}>Персональная лента</h1>
    {!current && error && <div className={s.loadFailure}>
      <p className="error" role="alert">{error}</p>
      <button className="button outline" type="button" onClick={reload}>Повторить</button>
    </div>}
    {!current && !error && <p className="muted" role="status">Загружаем события…</p>}
    <span className={s.announcement} role="status">{hasNew ? 'Появились новые события.' : ''}</span>
    {current && <section className={`panel ${cabinet.section}`} aria-label="События в ленте">
      {current.entries.length === 0 ? <p className="muted">Событий пока нет.</p> : <ul className={s.events}>
        {current.entries.map(event => <li className={s.event} key={event.id}>
          <span className={s.icon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icons[event.eventType]} /></svg></span>
          <div>
            <h2><Link to={event.linkPath}>{event.title}</Link></h2>
            <p>{event.details}</p>
          </div>
          <time dateTime={event.occurredAt}>{dateTime(event.occurredAt)} МСК</time>
        </li>)}
      </ul>}
      {loadError?.type === 'older' && <p className="error" role="alert">{loadError.message}</p>}
      {current.nextBeforeId !== null && <button className={`button outline ${s.more}`} type="button" disabled={!!busy}
        onClick={() => {
          if (current.nextBeforeId !== null) void load({ type: 'older', beforeId: current.nextBeforeId });
        }}>{busy === 'older' ? 'Загружаем…' : 'Показать ещё'}</button>}
      {hasNew && data && <div className={s.newEvents}>
        {loadError?.type === 'newer' && <p className="error" role="alert">{loadError.message}</p>}
        <button className="button primary" type="button" disabled={!!busy}
          onClick={() => void load({ type: 'newer', latest: data })}>
          {busy === 'newer' ? 'Загружаем новые события…' : 'Показать новые события'}
        </button>
      </div>}
    </section>}
  </>;
}
