import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, type StudentProfileData } from './api';
import { dateTime, StatusBadge } from './Assignments';
import { CabinetMetric, CabinetPage } from './Cabinet';
import cabinet from './cabinet.module.css';
import s from './profile.module.css';

const maxRating = 1000;

export function StudentProfile({ user, themeToggle }: { user: { id: number }; themeToggle: ReactNode }) {
  const { id } = useParams();
  const studentId = id ?? String(user.id);
  if (!/^\d+$/.test(studentId) || !Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) {
    return <CabinetPage themeToggle={themeToggle}><p className="error" role="alert">Профиль студента не найден.</p></CabinetPage>;
  }
  return <ProfileScreen key={studentId} studentId={Number(studentId)} ownProfile={Number(studentId) === user.id}
    themeToggle={themeToggle} />;
}

function ProfileScreen({ studentId, ownProfile, themeToggle }: {
  studentId: number; ownProfile: boolean; themeToggle: ReactNode;
}) {
  const [profile, setProfile] = useState<StudentProfileData>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    let timer: number | undefined;

    async function load() {
      try {
        const data = await api<StudentProfileData>(`/profiles/${studentId}`, { signal: request.signal });
        if (request.signal.aborted) return;
        setProfile(data);
        setError('');
        if (ownProfile) timer = window.setTimeout(load, 6000);
      } catch (failure) {
        if (request.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 404) {
          setProfile(undefined);
          setError('Профиль студента не найден.');
        } else {
          setError('Не удалось загрузить профиль.');
        }
      }
    }

    void load();
    return () => {
      request.abort();
      window.clearTimeout(timer);
    };
  }, [studentId, ownProfile, retry]);

  const { student, personal } = profile ?? {};
  const subtitle = student && [student.facultyName, student.groupName].filter(Boolean).join(' · ');
  const visibleAssignments = personal?.assignments.filter(item => (item.status === 'ACCEPTED') === completed);

  return <CabinetPage name={student?.fullName} subtitle={subtitle} themeToggle={themeToggle}>
    {error && <div className={s.feedback}>
      <p className="error" role="alert">{error}</p>
      <button type="button" className="button outline" onClick={() => { setError(''); setRetry(value => value + 1); }}>
        Обновить профиль
      </button>
    </div>}
    {!student && !error && <p className="muted" role="status">Загружаем профиль…</p>}
    {student && <dl className={cabinet.metrics} data-cabinet-metrics>
      <CabinetMetric label="Академический рейтинг" valueClassName={s.ratingValue}>
          <div><strong>{student.rating}</strong> <small>/ {maxRating}</small></div>
          <svg className={s.ring} viewBox="0 0 42 42" aria-hidden="true">
            <circle className={s.ringTrack} cx="21" cy="21" r="18" />
            <circle className={s.ringProgress} cx="21" cy="21" r="18" pathLength="100"
              strokeDasharray={`${100 * student.rating / maxRating} ${100 * (maxRating - student.rating) / maxRating}`}
              transform="rotate(-90 21 21)" />
          </svg>
      </CabinetMetric>
      <CabinetMetric label="Учебная активность"><span aria-label="Баллы пока недоступны">—</span> <small>БУА</small></CabinetMetric>
      <CabinetMetric label="Общественная активность"><span aria-label="Баллы пока недоступны">—</span> <small>БОА</small></CabinetMetric>
    </dl>}
    {personal && visibleAssignments && <div className={cabinet.sections} data-cabinet-sections>
      <section className={`panel ${cabinet.section} ${cabinet.widePanel}`} aria-labelledby="profile-assignments-title">
        <h2 id="profile-assignments-title">Задания</h2>
        <div className={s.filters} role="group" aria-label="Фильтр заданий">
          <button type="button" aria-pressed={!completed} onClick={() => setCompleted(false)}>Активные</button>
          <button type="button" aria-pressed={completed} onClick={() => setCompleted(true)}>Завершённые</button>
        </div>
        {visibleAssignments.length ? <ul className={s.list}>
          {visibleAssignments.map(item => <li key={item.id} className={s.assignmentRow}>
            <div>
              <Link to={`/assignments/${item.id}`} className={s.assignmentLink}>{item.title}</Link>
              <p className={s.date}>До <time dateTime={item.deadline}>{dateTime(item.deadline)} МСК</time></p>
            </div>
            <StatusBadge status={item.status} />
          </li>)}
        </ul> : <p className={s.empty}>{completed ? 'Завершённых заданий пока нет.' : 'Активных заданий пока нет.'}</p>}
      </section>
      <section className={`panel ${cabinet.section}`} aria-labelledby="profile-history-title">
        <h2 id="profile-history-title">История баллов</h2>
        {personal.ratingHistory.length ? <ul className={s.list}>
          {personal.ratingHistory.map(entry => <li key={entry.id} className={s.historyRow}>
            <div>
              <p className={s.historyTitle}>Просрочка: {entry.assignmentTitle}</p>
              <time className={s.date} dateTime={entry.recordedAt}>{dateTime(entry.recordedAt)} МСК</time>
            </div>
            <span className={s.deduction}>−{Math.abs(entry.amount)} АР</span>
          </li>)}
        </ul> : <p className={s.empty}>Изменений рейтинга пока нет.</p>}
      </section>
    </div>}
  </CabinetPage>;
}
