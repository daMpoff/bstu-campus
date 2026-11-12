import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, type ProfileAssignment, type StudentActivity, type StudentProfileData } from './api';
import { canSubmitWork, DeadlineIndicator, useDeadlineClock } from './AssignmentDeadline';
import { dateTime, StatusBadge } from './Assignments';
import { activityFormatLabels } from './Activities';
import { CabinetAvatar } from './Cabinet';
import { activityPointLabel, formatPoints, pointLabels } from './points';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import s from './profile.module.css';

const maxRating = 1000;
const day = 24 * 60 * 60 * 1000;
const byDeadline = (left: ProfileAssignment, right: ProfileAssignment) => Date.parse(left.deadline) - Date.parse(right.deadline);

function assignmentPenalty(item: ProfileAssignment, rating: number | undefined) {
  if (typeof item.penaltyLimit !== 'number' || typeof item.deducted !== 'number' || rating === undefined) return undefined;
  return { limit: item.penaltyLimit, deducted: item.deducted, rating };
}

function AcademicRating({ rating, place, ownProfile }: { rating: number; place: number | null; ownProfile: boolean }) {
  return <div className={`${s.metric} ${s.rating}`}>
    <dt className={s.ratingHeading}>
      <span>Академический рейтинг</span>
      {ownProfile && <Link to="/rating" className={s.ratingPlace}
        aria-label={place == null ? undefined : `${formatPoints(place)}-е место в рейтинге`}>
        {place == null ? 'Открыть рейтинг' : `${formatPoints(place)}-е место`}
        <span aria-hidden="true">→</span>
      </Link>}
    </dt>
    <dd>
      <div className={s.ratingNumber}><strong>{rating}</strong> <small>/ {maxRating}</small></div>
      <meter className={s.ratingMeter} min={0} max={maxRating} value={rating} aria-label="Академический рейтинг" data-rating-scale />
    </dd>
  </div>;
}

function ActivityBalance({ label, points, unit }: { label: string; points: number; unit: string }) {
  return <div className={s.metric}>
    <dt>{label}</dt>
    <dd>{formatPoints(points)} <small>{unit}</small></dd>
  </div>;
}

function ProfileSummary({ student, groupLeader, ownProfile }: {
  student: StudentProfileData['student']; groupLeader: boolean; ownProfile: boolean;
}) {
  return <section className={`panel ${s.summary}`} aria-labelledby="profile-name">
    <header className={s.identity} data-cabinet-header>
      <CabinetAvatar name={student.fullName} className={s.avatar} />
      <div>
        <h1 id="profile-name">{student.fullName}</h1>
        {student.facultyName && <p>{student.facultyName}</p>}
        <p>{student.groupName}{groupLeader && ' · Староста'}</p>
      </div>
    </header>
    <dl className={s.metrics} data-cabinet-metrics>
      <AcademicRating rating={student.rating} place={student.arPlace} ownProfile={ownProfile} />
      <ActivityBalance label="Учебная активность" points={student.academicActivityPoints} unit="БУА" />
      <ActivityBalance label="Общественная активность" points={student.publicActivityPoints} unit="БОА" />
    </dl>
  </section>;
}

function SubmissionOverview({ assignments }: { assignments: ProfileAssignment[] }) {
  const now = useDeadlineClock();
  const actionable = useMemo(() => assignments.filter(item => canSubmitWork(item.status)).sort(byDeadline), [assignments]);
  const overdue = actionable.filter(item => item.status === 'OVERDUE' || Date.parse(item.deadline) <= now);
  const soon = actionable.filter(item => item.status !== 'OVERDUE' && Date.parse(item.deadline) > now && Date.parse(item.deadline) <= now + day);
  const waiting = assignments.filter(item => item.status === 'SUBMITTED').length;
  const next = overdue[0] ?? actionable[0];

  return <section className={`panel ${cabinet.section} ${cabinet.widePanel}`} aria-labelledby="student-submissions">
    <h2 id="student-submissions">Сдача работ</h2>
    <dl className={s.submissionCounts}>
      <div><dt>Просрочено</dt><dd data-overdue={overdue.length > 0}>{overdue.length}</dd></div>
      <div><dt>До 24 ч</dt><dd>{soon.length}</dd></div>
      <div><dt>На проверке</dt><dd>{waiting}</dd></div>
    </dl>
    {next ? <div className={s.nextAssignment}>
      <div>
        <p className={s.itemLabel}>{overdue.length ? 'Просроченное задание' : 'Ближайший дедлайн'}</p>
        <p className={s.historyTitle}>{next.title}</p>
        <DeadlineIndicator deadline={next.deadline} status={next.status} />
      </div>
      <Link className="button primary" to={`/assignments/${next.id}`}>Открыть задание <span aria-hidden="true">→</span></Link>
    </div> : <p className={s.empty}>Заданий, которые нужно сдать, пока нет.</p>}
  </section>;
}

type UpcomingPoll = { id: number; title: string; endsAt: string; closed: boolean; voted: boolean };

function UpcomingEvents() {
  const activities = useCabinetResource<StudentActivity[]>('/student/activities', 30000);
  const polls = useCabinetResource<UpcomingPoll[]>('/student/polls', 30000);
  const now = Date.now();
  const activity = activities.data?.filter(item => Date.parse(item.activity.occursAt) > now)
    .sort((left, right) => Date.parse(left.activity.occursAt) - Date.parse(right.activity.occursAt))[0]?.activity;
  const poll = polls.data?.filter(item => !item.closed && !item.voted && Date.parse(item.endsAt) > now)
    .sort((left, right) => Date.parse(left.endsAt) - Date.parse(right.endsAt))[0];

  return <section className={`panel ${cabinet.section}`} aria-labelledby="student-upcoming">
    <h2 id="student-upcoming">Ближайшие события</h2>
    {activity && <div className={s.upcomingItem}>
      <p className={s.itemLabel}>{activity.kind === 'ACADEMIC' ? 'Учебная активность' : 'Общественная активность'}</p>
      <Link to={`/activities#activity-${activity.id}`} className={s.eventLink}>{activity.title}</Link>
      <p className={s.date}><time dateTime={activity.occursAt}>{dateTime(activity.occursAt)} МСК</time>
        {activity.format && ` · ${activityFormatLabels[activity.format]}`}
        {' · до '}{formatPoints(activity.maxPoints)} {activityPointLabel(activity.kind)}</p>
    </div>}
    {poll && <div className={s.upcomingItem}>
      <p className={s.itemLabel}>Опрос</p>
      <Link to={`/polls/${poll.id}`} className={s.eventLink}>{poll.title}</Link>
      <p className={s.date}>До <time dateTime={poll.endsAt}>{dateTime(poll.endsAt)} МСК</time></p>
    </div>}
    {!activity && !poll && <p className={s.empty}>{activities.error || polls.error
      ? 'Не удалось загрузить ближайшие события.'
      : activities.data && polls.data ? 'Ближайших активностей и открытых опросов пока нет.' : 'Загружаем события…'}</p>}
  </section>;
}

export function StudentProfile({ user }: {
  user: { id: number; groupVerified: boolean; groupLeader: boolean };
}) {
  const { id } = useParams();
  const studentId = id ?? String(user.id);
  if (!/^\d+$/.test(studentId) || !Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) {
    return <main className={cabinet.page} data-cabinet-page>
      <h1 className={s.profileTitle}>Профиль студента</h1>
      <p className="error" role="alert">Профиль студента не найден.</p>
    </main>;
  }
  return <ProfileScreen key={studentId} studentId={Number(studentId)} ownProfile={Number(studentId) === user.id}
    pendingGroup={Number(studentId) === user.id && !user.groupVerified}
    groupLeader={Number(studentId) === user.id && user.groupLeader} />;
}

function ProfileScreen({ studentId, ownProfile, pendingGroup, groupLeader }: {
  studentId: number; ownProfile: boolean; pendingGroup: boolean; groupLeader: boolean;
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
  const visibleAssignments = personal?.assignments.filter(item => (item.status === 'ACCEPTED') === completed);
  if (ownProfile && !completed) {
    visibleAssignments?.sort((left, right) =>
      Number(canSubmitWork(right.status)) - Number(canSubmitWork(left.status)) || byDeadline(left, right));
  }

  return <main className={`${cabinet.page} ${s.profile}`} data-cabinet-page>
    {student ? <ProfileSummary student={student} groupLeader={groupLeader} ownProfile={ownProfile} />
      : <h1 className={s.profileTitle}>Профиль студента</h1>}
    {pendingGroup && <p className={`panel ${cabinet.section} ${s.pendingGroup}`} role="status">
      Группа ожидает подтверждения. После одобрения здесь появятся задания группы.
    </p>}
    {error && <div className={s.feedback}>
      <p className="error" role="alert">{error}</p>
      <button type="button" className="button outline" onClick={() => { setError(''); setRetry(value => value + 1); }}>
        Обновить профиль
      </button>
    </div>}
    {!student && !error && <p className="muted" role="status">Загружаем профиль…</p>}
    {ownProfile && !pendingGroup && personal && <div className={`${cabinet.sections} ${s.overview}`}>
      <SubmissionOverview assignments={personal.assignments} />
      <UpcomingEvents />
    </div>}
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
              {ownProfile
                ? <Link to={`/assignments/${item.id}`} className={s.assignmentLink}>{item.title}</Link>
                : <span className={s.historyTitle}>{item.title}</span>}
              <p className={s.date}>До <time dateTime={item.deadline}>{dateTime(item.deadline)} МСК</time></p>
              {ownProfile && <DeadlineIndicator deadline={item.deadline} status={item.status} penalty={assignmentPenalty(item, student?.rating)} />}
            </div>
            <StatusBadge status={item.status} />
          </li>)}
        </ul> : <p className={s.empty}>{completed ? 'Завершённых заданий пока нет.' : 'Активных заданий пока нет.'}</p>}
      </section>
      <section className={`panel ${cabinet.section}`} aria-labelledby="profile-history-title">
        <h2 id="profile-history-title">История баллов</h2>
        {personal.ratingHistory.length ? <ul className={s.list}>
          {personal.ratingHistory.map(entry => <li key={`${entry.currency}-${entry.id}`} className={s.historyRow}>
            <div>
              <p className={s.historyTitle}>{entry.activityTitle ?? (entry.semesterStart
                ? 'Пополнение в начале семестра' : entry.assignmentTitle ? `Просрочка: ${entry.assignmentTitle}` : 'Просрочка задания')}</p>
              {entry.teacherName && <span className={s.date}>Начислил преподаватель · {entry.teacherName}</span>}
              <time className={s.date} dateTime={entry.recordedAt}>{dateTime(entry.recordedAt)} МСК</time>
            </div>
            <span className={s.ratingChange} data-credit={entry.amount > 0}>
              {entry.amount > 0 ? '+' : '−'}{formatPoints(Math.abs(entry.amount))} {pointLabels[entry.currency]}
            </span>
          </li>)}
        </ul> : <p className={s.empty}>Изменений баллов пока нет.</p>}
      </section>
    </div>}
  </main>;
}
