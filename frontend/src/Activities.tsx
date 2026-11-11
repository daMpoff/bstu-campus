import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { post, type Activity, type ActivityDetail, type ActivityKind, type ActivityParticipant, type Group, type ParticipationLevel, type StudentActivity } from './api';
import { dateTime } from './Assignments';
import { activityPointLabel, formatPoints } from './points';
import { TargetGroups } from './TargetGroups';
import { useCabinetResource } from './useCabinetResource';
import form from './assignments.module.css';
import cabinet from './cabinet.module.css';
import s from './activities.module.css';

const levels: ParticipationLevel[] = [25, 50, 75, 100];
const activityLabels = { ACADEMIC: 'Учебная', PUBLIC: 'Общественная' };
const panel = `panel ${cabinet.section}`;
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : 'Не удалось выполнить запрос.';

function ActivityInfo({ activity }: { activity: Activity }) {
  return <>
    <p className={s.description}>{activity.description}</p>
    <p className={s.meta}>
      <time dateTime={activity.occursAt}>{dateTime(activity.occursAt)} МСК</time>
      {' · до '}{formatPoints(activity.maxPoints)} {activityPointLabel(activity.kind)}
    </p>
  </>;
}

function ActivityGroups({ groups }: { groups: string[] }) {
  return <div className={s.groups}>{groups.map(group => <span key={group}>{group}</span>)}</div>;
}

function ActivityKindLabel({ kind }: { kind: ActivityKind }) {
  return <span className={s.kind} data-public={kind === 'PUBLIC'}>{activityLabels[kind]}</span>;
}

export function TeacherActivities() {
  const { data, error } = useCabinetResource<Activity[]>('/teacher/activities');
  return <>
    <div className={s.heading}><h1>Активности</h1><Link className="button primary" to="/activities/new">Новая активность</Link></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем активности…</p>}
    {data?.length === 0 && <p className={panel}>Активностей пока нет.</p>}
    <div className={s.cards}>{data?.map(activity => <article className={panel} key={activity.id}>
      <div className={s.cardHeading}><h2><Link to={`/activities/${activity.id}`}>{activity.title}</Link></h2>
        <ActivityKindLabel kind={activity.kind} /></div>
      <ActivityInfo activity={activity} />
      <ActivityGroups groups={activity.groups} />
    </article>)}</div>
  </>;
}

export function StudentActivities() {
  const { data, error, reload } = useCabinetResource<StudentActivity[]>('/student/activities', 6000);
  const { hash } = useLocation();
  const activityAnchor = data?.find(({ activity }) => hash === `#activity-${activity.id}`)?.activity.id;
  const [busy, setBusy] = useState<number>();
  const [enrollmentError, setEnrollmentError] = useState<{ id: number; message: string }>();
  const [enrollmentNotice, setEnrollmentNotice] = useState<number>();

  useEffect(() => {
    if (activityAnchor === undefined) return;
    const activity = document.getElementById(`activity-${activityAnchor}`);
    activity?.focus({ preventScroll: true });
    activity?.scrollIntoView({ block: 'start' });
  }, [activityAnchor]);

  async function enroll(id: number) {
    if (busy) return;
    setBusy(id);
    setEnrollmentError(undefined);
    setEnrollmentNotice(undefined);
    try {
      await post(`/student/activities/${id}/enroll`, {});
      setEnrollmentNotice(id);
    } catch (failure) {
      setEnrollmentError({ id, message: failureText(failure) });
    } finally {
      reload();
      setBusy(undefined);
    }
  }

  return <>
    <div className={s.heading}><h1>Активности</h1></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем активности…</p>}
    {data?.length === 0 && <p className={panel}>Для вашей группы пока нет активностей.</p>}
    <div className={s.cards}>{data?.map(({ activity, participation, points, enrolled, canEnroll }) => <article
      className={`${panel} ${s.activityAnchor}`} key={activity.id} id={`activity-${activity.id}`} aria-labelledby={`activity-title-${activity.id}`} tabIndex={-1}>
      <div className={s.cardHeading}><h2 id={`activity-title-${activity.id}`}>{activity.title}</h2><ActivityKindLabel kind={activity.kind} /></div>
      <ActivityInfo activity={activity} />
      <p className={s.meta}>Преподаватель · {activity.teacherName}</p>
      {points !== null ? <p className={s.earned}>Участие {participation}% · +{formatPoints(points)} {activityPointLabel(activity.kind)}</p>
        : activity.kind === 'ACADEMIC'
          ? <p className={s.meta}>{Date.parse(activity.occursAt) > Date.now() ? 'Предстоит' : 'Участие пока не подтверждено'}</p>
          : enrolled || enrollmentNotice === activity.id ? <p className={s.earned} role="status">Вы записаны</p>
          : canEnroll ? <button type="button" className={`button primary ${s.enroll}`} disabled={busy !== undefined}
            onClick={() => void enroll(activity.id)}>{busy === activity.id ? 'Записываем…' : 'Записаться'}</button>
          : <p className={s.meta}>Запись закрыта</p>}
      {enrollmentError?.id === activity.id && <p className="error" role="alert">{enrollmentError.message}</p>}
    </article>)}</div>
  </>;
}

export function NewActivity() {
  const { data: groups, error: groupError } = useCabinetResource<Group[]>('/teacher/groups');
  const [selected, setSelected] = useState<number[]>([]);
  const [kind, setKind] = useState<ActivityKind>('ACADEMIC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!selected.length) {
      setError('Выберите хотя бы одну учебную группу.');
      return;
    }
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await post<{ id: number }>('/teacher/activities', {
        title: fields.get('title'), description: fields.get('description'), groupIds: selected, kind,
        occursAt: new Date(`${fields.get('date')}T${fields.get('time')}:00+03:00`).toISOString(),
        maxPoints: Number(fields.get('points')),
      });
      navigate(`/activities/${result.id}`);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Link className="back" to="/activities">← Активности</Link>
    <div className={s.heading}><h1>Новая активность</h1></div>
    <form className={`${panel} ${form.form} ${s.activityForm}`} onSubmit={create}>
      <label className={form.field}><span>Тип активности</span>
        <select aria-label="Тип активности" value={kind} onChange={event => setKind(event.target.value === 'PUBLIC' ? 'PUBLIC' : 'ACADEMIC')}>
          <option value="ACADEMIC">Учебная · БУА</option>
          <option value="PUBLIC">Общественная · БОА</option>
        </select>
      </label>
      <label className={form.field}><span>Название</span><input name="title" maxLength={160} required /></label>
      <label className={form.field}><span>Описание</span><textarea name="description" maxLength={5000} rows={3} required /></label>
      <TargetGroups groups={groups} selected={selected} onChange={setSelected} />
      <div className={form.field}><span>Проведение</span>
        <div className={form.deadline}>
          <label>Дата проведения<input type="date" name="date" required /></label>
          <label>Время (МСК)<input type="time" name="time" defaultValue="15:00" required /></label>
        </div>
      </div>
      <label className={form.field}><span>Максимум, {activityPointLabel(kind)}</span><input type="number" name="points" min={1} max={2147483647} defaultValue={80} required /></label>
      <div className={form.formFooter}>
        {(error || groupError) && <p className="error" role="alert">{error || groupError}</p>}
        <button type="submit" className="button primary" disabled={busy || !groups}>{busy ? 'Создаём…' : 'Создать активность'}</button>
      </div>
    </form>
  </>;
}

function ParticipantRow({ participant, activity, canConfirm, busy, onConfirm }: {
  participant: ActivityParticipant; activity: Activity; canConfirm: boolean; busy: boolean;
  onConfirm: (studentId: number, participation: ParticipationLevel) => void;
}) {
  const [level, setLevel] = useState<ParticipationLevel>();
  const unit = activityPointLabel(activity.kind);
  return <li className={s.participant}>
    <div>
      <Link className={s.studentName} to={`/profiles/${participant.studentId}`}>{participant.studentName}</Link>
      <p className={s.meta}>{participant.groupName}</p>
    </div>
    {participant.points !== null
      ? <p className={s.earned}>Участие {participant.participation}% · +{formatPoints(participant.points)} {unit}</p>
      : canConfirm && <div className={s.confirm}>
        <label>Доля участия
          <select aria-label={`Доля участия · ${participant.studentName}`} value={level ?? ''}
            onChange={event => setLevel(event.target.value ? Number(event.target.value) as ParticipationLevel : undefined)}>
            <option value="">Выбрать</option>
            {levels.map(option => <option value={option} key={option}>{option}% · {formatPoints(activity.maxPoints * option / 100)} {unit}</option>)}
          </select>
        </label>
        <button type="button" className="button primary" disabled={busy || !level}
          onClick={() => { if (level) onConfirm(participant.studentId, level); }}>Подтвердить</button>
      </div>}
  </li>;
}

export function TeacherActivityDetail() {
  const { id } = useParams();
  if (!id || !/^\d+$/.test(id)) return <p className="error" role="alert">Активность не найдена.</p>;
  return <ActivityScreen id={id} key={id} />;
}

function ActivityScreen({ id }: { id: string }) {
  const { data, error, reload } = useCabinetResource<ActivityDetail>(`/teacher/activities/${id}`, 6000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  async function confirm(studentId: number, participation: ParticipationLevel) {
    if (busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await post(`/teacher/activities/${id}/confirm`, { studentId, participation });
      setNotice('Баллы начислены.');
    } catch (failure) {
      setActionError(failureText(failure));
    } finally {
      reload();
      setBusy(false);
    }
  }

  return <>
    <Link className="back" to="/activities">← Активности</Link>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем активность…</p>}
    {data && <>
      <div className={s.heading}><div><div className={s.cardHeading}><h1>{data.activity.title}</h1><ActivityKindLabel kind={data.activity.kind} /></div><ActivityInfo activity={data.activity} />
        <ActivityGroups groups={data.activity.groups} /></div></div>
      <div className={cabinet.sections}>
        <section className={`${panel} ${cabinet.widePanel}`} aria-labelledby="participants-title">
          <h2 id="participants-title">Участники</h2>
          {data.canConfirm
            ? <p className={s.meta}>Выберите долю от максимума по вкладу студента.</p>
            : <p className={s.meta}>Участие можно подтвердить после наступления даты проведения.</p>}
          {actionError && <p className="error" role="alert">{actionError}</p>}
          {notice && <p className={s.earned} role="status">{notice}</p>}
          {!data.participants.length && <p className={s.meta}>{data.activity.kind === 'PUBLIC'
            ? 'Пока никто не записался.' : 'В выбранных группах пока нет студентов.'}</p>}
          <ul className={s.list}>{data.participants.map(participant =>
            <ParticipantRow key={participant.studentId} participant={participant} activity={data.activity}
              canConfirm={data.canConfirm} busy={busy} onConfirm={(student, level) => void confirm(student, level)} />)}</ul>
        </section>
        <section className={panel} aria-labelledby="activity-budget-title">
          <h2 id="activity-budget-title">Бюджет групп</h2>
          <p className={s.meta}>{monthFormatter.format(new Date(`${data.budgetMonth}T00:00:00Z`))}</p>
          <ul className={s.list}>{data.budgets.map(budget => <li className={s.budget} key={budget.groupId}>
            <strong>{budget.groupName}</strong>
            <p>Осталось {formatPoints(budget.remaining)} из {formatPoints(budget.limit)} баллов</p>
            <p className={s.meta}>Потрачено {formatPoints(budget.spent)} · Начислений {budget.awards}</p>
          </li>)}</ul>
        </section>
      </div>
    </>}
  </>;
}
