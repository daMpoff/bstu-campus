import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post, type Account, type Group, type Status, type StudentAssignment, type TeacherAssignment, type Work } from './api';
import { AssignmentDraft } from './AssignmentDraft';
import { canSubmitWork, DeadlineIndicator, formatRemainingPenalty, PenaltyAmounts, remainingPenalty } from './AssignmentDeadline';
import { AssignmentMaterials } from './AssignmentMaterials';
import { Attachments } from './AttachmentPreview';
import { TargetGroups } from './TargetGroups';
import { useCabinetResource } from './useCabinetResource';
import s from './assignments.module.css';

const statusLabels: Record<Status, string> = {
  OPEN: 'В процессе', OVERDUE: 'Просрочено', SUBMITTED: 'Сдано на проверку', RETURNED: 'На доработке', ACCEPTED: 'Принято',
};

const formatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
});
export const dateTime = (value: string) => formatter.format(new Date(value));
const failureText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос.';

function Heading({ trail, title, description }: { trail?: ReactNode; title: string; description?: string }) {
  return <>
    <div className={s.trail}>{trail ?? <>Кабинет <span>/</span> {title}</>}</div>
    <div className={s.heading}><div><h1>{title}</h1>{description && <p>{description}</p>}</div></div>
  </>;
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={s.status} data-status={status}>{statusLabels[status]}</span>;
}

export function AssignmentList({ user }: { user: Account }) {
  const [items, setItems] = useState<StudentAssignment[]>();
  const [rating, setRating] = useState(user.rating);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [items, account] = await Promise.all([api<StudentAssignment[]>('/student/assignments'), api<Account>('/me')]);
        if (!active) return;
        setItems(items);
        setRating(account.rating);
        setError('');
      } catch (failure) {
        if (active) setError(failureText(failure));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => { active = false; clearInterval(timer); };
  }, [user.id]);

  return <>
    <Heading title="Задания" description="Следите за сроками и статусами ваших работ." />
    <div className={s.rating}><span>Академический рейтинг</span><strong>{rating} <small>из 1000</small></strong></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!items && !error && <p className="muted">Загрузка заданий…</p>}
    {items?.length === 0 && <div className={`panel ${s.empty}`}><h2>Заданий пока нет</h2><p>Здесь появятся задания вашей группы.</p></div>}
    <div className={s.cards}>{items?.map(item => <Link key={item.id} to={`/assignments/${item.id}`}
      className={`panel ${s.card}`} aria-labelledby={`assignment-title-${item.id}`}>
      <div><h2 id={`assignment-title-${item.id}`}>{item.title}</h2><p>{item.teacherName} · {item.individual && 'Личное задание · '}
        до <time dateTime={item.deadline}>{dateTime(item.deadline)} МСК</time></p>
        <DeadlineIndicator deadline={item.deadline} status={item.status} penalty={{ deducted: item.deducted, limit: item.penaltyLimit, rating }} />
      </div>
      <StatusBadge status={item.status} /><span className={s.arrow} aria-hidden="true">→</span>
    </Link>)}</div>
  </>;
}

export function NewAssignment() {
  const [groups, setGroups] = useState<Group[]>();
  const [selected, setSelected] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    api<Group[]>('/teacher/groups').then(value => { if (active) setGroups(value); }).catch(failure => { if (active) setError(failureText(failure)); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!selected.length) {
      setError('Выберите хотя бы одну учебную группу.');
      return;
    }
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await post<{ id: number }>('/teacher/assignments', {
        title: fields.get('title'), description: fields.get('description'), groupIds: selected,
        deadline: new Date(`${fields.get('date')}T${fields.get('time')}:00+03:00`).toISOString(),
        penaltyLimit: Number(fields.get('limit')),
      });
      navigate(`/assignments/${result.id}`);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Heading trail={<><Link to="/assignments">Задания</Link><span>/</span> Новое задание</>} title="Новое задание"
      description="Назначьте задание учебным группам и задайте параметры выполнения." />
    <div className={s.formLayout}>
      <form className={`panel ${s.form}`} onSubmit={submit}>
        <AssignmentDraft onApply={draft => { setTitle(draft.title); setDescription(draft.description); titleInput.current?.focus(); }} />
        <label className={s.field}><span>Название <b>*</b></span><input ref={titleInput} name="title" value={title} onChange={event => setTitle(event.target.value)} placeholder="Курсовая работа — этап 1" maxLength={160} required /></label>
        <label className={s.field}><span>Описание <b>*</b></span><textarea name="description" value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={5000} required placeholder="Что нужно сделать и как сдать работу?" /></label>
        <TargetGroups groups={groups} selected={selected} onChange={setSelected} />
        <div className={s.field}><span>Дедлайн <b>*</b></span><div className={s.deadline}><label>Дата<input type="date" name="date" required /></label><label>Время (МСК)<input type="time" name="time" defaultValue="23:59" required /></label></div></div>
        <label className={s.field}><span>Лимит списания, АР <b>*</b></span><input type="number" name="limit" min={0} max={1000} defaultValue={100} required /></label>
        <div className={s.formFooter}>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="button primary" disabled={busy || !groups}>{busy ? 'Назначаем…' : 'Назначить задание'} <span aria-hidden="true">→</span></button>
        </div>
      </form>
      <aside className={s.reminder}><h2>Напоминание</h2><ul><li>Списание не превысит лимит задания.</li><li>После дедлайна рейтинг списывается автоматически.</li><li>Рейтинг не опускается ниже 0.</li></ul></aside>
    </div>
  </>;
}

export function AssignmentDetail({ user }: { user: Account }) {
  const { id } = useParams();
  return user.role === 'TEACHER' ? <TeacherDetail key={id} id={Number(id)} /> : <StudentDetail key={id} id={Number(id)} user={user} />;
}

function TeacherDetail({ id }: { id: number }) {
  const { data: assignments, error: assignmentError } = useCabinetResource<TeacherAssignment[]>('/teacher/assignments');
  const { data: currentWorks, error: workError, reload: refresh } = useCabinetResource<Work[]>(`/teacher/assignments/${id}/works`, 6000);
  const [selected, setSelected] = useState<number[]>([]);
  const [reviewError, setReviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const item = assignments?.find(assignment => assignment.id === id);
  const works = currentWorks ?? [];
  const selectedWorks = selected.filter(student => works.some(work => work.studentId === student && work.status === 'SUBMITTED'));
  const error = reviewError || assignmentError || workError;
  const overdue = item !== undefined && Date.parse(item.deadline) <= Date.now();

  useEffect(() => {
    if (!currentWorks) return;
    const waiting = new Set(currentWorks.filter(work => work.status === 'SUBMITTED').map(work => work.studentId));
    setSelected(ids => ids.every(id => waiting.has(id)) ? ids : ids.filter(id => waiting.has(id)));
  }, [currentWorks]);

  async function review(action: 'ACCEPTED' | 'RETURNED') {
    setBusy(true);
    setReviewError('');
    setNotice('');
    try {
      await post(`/teacher/assignments/${id}/review`, { action, studentIds: selectedWorks });
      setSelected([]);
      setNotice(action === 'ACCEPTED' ? 'Работы приняты.' : 'Работы возвращены на доработку.');
      refresh();
    } catch (failure) {
      setReviewError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Heading trail={<><Link to="/assignments">Задания</Link><span>/</span> Проверка работ</>} title={item?.title ?? 'Задание'}
      description={item && `${item.individual ? 'Личное задание · ' : ''}${item.groups.join(', ')} · дедлайн ${dateTime(item.deadline)} МСК`} />
    {error && <p className="error" role="alert">{error}</p>}
    {item && <div className="panel">
      <DeadlineIndicator deadline={item.deadline}
        allSubmitted={currentWorks ? !works.some(work => canSubmitWork(work.status)) : item.total === item.accepted + item.waiting} />
      <p className={s.description}>{item.description}</p>
      <div className={s.sectionHeading}><h2>Работы студентов</h2><button className="button outline" type="button" onClick={refresh}>Обновить</button></div>
      <div className={s.actions}>
        <button className="button primary" onClick={() => void review('ACCEPTED')} disabled={!selectedWorks.length || busy}>Принять выбранные</button>
        <button className="button outline" onClick={() => void review('RETURNED')} disabled={!selectedWorks.length || busy}>Вернуть на доработку</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {currentWorks?.length === 0 && <p className="muted">В выбранных группах пока нет студентов.</p>}
      <ul className={s.works}>{works.map(work => <li key={work.studentId}>
        <div className={s.workPerson}><input type="checkbox" aria-label={work.studentName} disabled={work.status !== 'SUBMITTED' || busy}
          checked={selectedWorks.includes(work.studentId)} onChange={event => setSelected(ids => event.target.checked ? [...ids, work.studentId] : ids.filter(student => student !== work.studentId))} />
          <div><Link to={`/profiles/${work.studentId}`} className={s.studentLink}>{work.studentName}</Link><small>{work.groupName}</small>
            {(overdue || work.status === 'OVERDUE') && canSubmitWork(work.status)
              ? <PenaltyAmounts deducted={work.deducted} limit={item.penaltyLimit} rating={work.rating} />
              : <small>Списано {work.deducted} АР</small>}
          </div>
        </div>
        <StatusBadge status={work.status} /><Attachments work={work} studentId={work.studentId} assignmentId={id} />
      </li>)}</ul>
      <AssignmentMaterials assignmentId={id} teacher />
    </div>}
  </>;
}

function StudentDetail({ user, id }: { user: Account; id: number }) {
  const [item, setItem] = useState<StudentAssignment>();
  const [rating, setRating] = useState(user.rating);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const refreshVersion = useRef(0);

  async function load() {
    const [items, account] = await Promise.all([api<StudentAssignment[]>('/student/assignments'), api<Account>('/me')]);
    const current = items.find(assignment => assignment.id === id);
    if (!current) throw new Error('Задание недоступно.');
    return { current, rating: account.rating };
  }

  useEffect(() => {
    let active = true;
    async function refresh() {
      const version = refreshVersion.current;
      try {
        const result = await load();
        if (active && version === refreshVersion.current) {
          setItem(result.current);
          setRating(result.rating);
          setLoadError('');
        }
      } catch (failure) {
        if (active && version === refreshVersion.current) setLoadError(failureText(failure));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    setNotice('');
    const fields = new FormData(event.currentTarget);
    const file = fields.get('file');
    if (!String(fields.get('link')).trim() && (!(file instanceof File) || !file.size)) {
      setSubmitError('Приложите ссылку или файл.');
      return;
    }
    setBusy(true);
    try {
      await api(`/student/assignments/${id}/submit`, { method: 'POST', body: fields });
      refreshVersion.current += 1;
      setItem(current => current && { ...current, status: 'SUBMITTED', link: null, fileName: null });
      setNotice('Работа отправлена на проверку.');
      try {
        const result = await load();
        setItem(result.current);
        setRating(result.rating);
        setLoadError('');
      } catch (failure) {
        setLoadError(failureText(failure));
      }
    } catch (failure) {
      setSubmitError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = item !== undefined && canSubmitWork(item.status);
  const remaining = item ? remainingPenalty(item.penaltyLimit, item.deducted, rating) : 0;
  let submissionNote = 'После сдачи списание по этому заданию остановится.';
  if (item?.penaltyLimit === 0) {
    submissionNote = 'За это задание АР не списывается.';
  } else if (item && item.deducted >= item.penaltyLimit) {
    submissionNote = 'Лимит задания исчерпан. Больше АР по нему не спишется.';
  } else if (rating === 0) {
    submissionNote = 'Общий рейтинг сейчас равен нулю. ' + submissionNote;
  } else if (item?.status === 'OPEN') {
    submissionNote = 'Списание начинается после дедлайна. ' + submissionNote;
  }

  return <>
    <Heading trail={<><Link to="/assignments">Задания</Link><span>/</span> Просмотр</>} title={item?.title ?? 'Задание'}
      description={item && `${item.teacherName} · ${item.individual ? 'личное задание · ' : ''}дедлайн ${dateTime(item.deadline)} МСК`} />
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {item && <div className={s.formLayout}>
      <section className="panel">
        <div className={s.assignmentTiming}>
          <StatusBadge status={item.status} />
          <DeadlineIndicator deadline={item.deadline} status={item.status} />
        </div>
        <p className={s.description}>{item.description}</p>
        <Attachments work={item} assignmentId={id} studentId={user.id} ownWork />
        <AssignmentMaterials assignmentId={id} />
        {notice && <p role="status">{notice}</p>}
        {canSubmit && <form className={s.submission} onSubmit={submit}>
          <h2>{item.status === 'RETURNED' ? 'Отправить исправленную работу' : 'Сдать работу'}</h2>
          <label>Ссылка на работу<input name="link" type="url" placeholder="https://" maxLength={2048} /></label>
          <label>Или файл до 10 МБ<input name="file" type="file" /></label>
          {submitError && <p className="error" role="alert">{submitError}</p>}
          <section className={s.submissionImpact} aria-label="Списание по заданию">
            <dl>
              <div><dt>Списано за задание</dt><dd>{item.deducted} АР</dd></div>
              <div><dt>Ещё может списаться</dt><dd>{formatRemainingPenalty(remaining)}</dd></div>
            </dl>
            <p id="submission-rating-note">{submissionNote}</p>
          </section>
          <button type="submit" className="button primary" disabled={busy} aria-describedby="submission-rating-note">
            {busy ? 'Отправляем…' : 'Сдать работу'} <span aria-hidden="true">→</span>
          </button>
        </form>}
      </section>
      <aside className={`panel ${s.ratingDetails}`}>
        <h2>{canSubmit ? 'Академический рейтинг' : 'Списание по заданию'}</h2>
        <dl>
          {!canSubmit && <div><dt>Списано за задание</dt><dd>{item.deducted} АР</dd></div>}
          {canSubmit && <div><dt>Лимит списания за это задание</dt><dd>{item.penaltyLimit} АР</dd></div>}
          <div><dt>Общий рейтинг</dt><dd>{rating} из 1000 АР</dd></div>
        </dl>
        {item.status === 'ACCEPTED' && <p>Работа принята. Больше АР по этому заданию не спишется.</p>}
        {item.status === 'SUBMITTED' && <p>{item.deducted >= item.penaltyLimit
          ? 'Работа на проверке. Больше АР по этому заданию не спишется.'
          : 'Списание приостановлено на время проверки. Если работу вернут после дедлайна, оно может возобновиться.'}</p>}
      </aside>
    </div>}
  </>;
}
