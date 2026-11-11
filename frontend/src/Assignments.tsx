import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post, type Account, type Attachment, type Group, type Status, type StudentAssignment, type TeacherAssignment, type Work } from './api';
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

export function Attachments({ work, assignmentId, studentId }: { work: Attachment; assignmentId: number; studentId: number }) {
  return <div className={s.attachments}>
    {work.link && <a href={work.link} target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>}
    {work.fileName && <a href={`/api/works/${assignmentId}/files/${studentId}`}>Скачать {work.fileName} ↓</a>}
  </div>;
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
    <div className={s.cards}>{items?.map(item => <Link key={item.id} to={`/assignments/${item.id}`} className={`panel ${s.card}`}>
      <div><h2>{item.title}</h2><p>{item.teacherName} · {dateTime(item.deadline)} МСК</p></div>
      <StatusBadge status={item.status} /><span className={s.arrow} aria-hidden="true">→</span>
    </Link>)}</div>
  </>;
}

export function NewAssignment() {
  const [groups, setGroups] = useState<Group[]>();
  const [groupSearch, setGroupSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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

  const query = groupSearch.trim().toLocaleLowerCase('ru-RU');
  const visibleGroups = groups?.filter(group =>
    selected.includes(group.id) || group.name.toLocaleLowerCase('ru-RU').includes(query));

  return <>
    <Heading trail={<><Link to="/assignments">Задания</Link><span>/</span> Новое задание</>} title="Новое задание"
      description="Назначьте задание учебным группам и задайте параметры выполнения." />
    <div className={s.formLayout}>
      <form className={`panel ${s.form}`} onSubmit={submit}>
        <label className={s.field}><span>Название <b>*</b></span><input name="title" placeholder="Курсовая работа — этап 1" maxLength={160} required /></label>
        <label className={s.field}><span>Описание <b>*</b></span><textarea name="description" rows={3} maxLength={5000} required placeholder="Что нужно сделать и как сдать работу?" /></label>
        <fieldset className={s.groupField}>
          <legend>Учебные группы <b>*</b></legend>
          <div className={s.groupPicker}>
            <input type="search" aria-label="Поиск учебной группы" placeholder="Введите часть шифра группы"
              value={groupSearch} onChange={event => setGroupSearch(event.target.value)} disabled={!groups} />
            <div className={s.groupOptions}>
              {!groups && <span className="muted">Загрузка групп…</span>}
              {visibleGroups?.length === 0 && <span className="muted">Группы не найдены.</span>}
              {visibleGroups?.map(group => <label key={group.id} className={s.groupChoice}>
                <input type="checkbox" checked={selected.includes(group.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id))} />
                <span>{group.name}</span>
              </label>)}
            </div>
          </div>
        </fieldset>
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
  const [item, setItem] = useState<TeacherAssignment>();
  const [works, setWorks] = useState<Work[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([api<TeacherAssignment[]>('/teacher/assignments'), api<Work[]>(`/teacher/assignments/${id}/works`)])
      .then(([items, current]) => { if (active) { setItem(items.find(assignment => assignment.id === id)); setWorks(current); } })
      .catch(failure => { if (active) setError(failureText(failure)); });
    return () => { active = false; };
  }, [id]);

  async function refresh() {
    try {
      const current = await api<Work[]>(`/teacher/assignments/${id}/works`);
      setWorks(current);
      setSelected(ids => ids.filter(student => current.some(work => work.studentId === student && work.status === 'SUBMITTED')));
    } catch (failure) {
      setError(failureText(failure));
    }
  }

  async function review(action: 'ACCEPTED' | 'RETURNED') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await post(`/teacher/assignments/${id}/review`, { action, studentIds: selected });
      setSelected([]);
      setNotice(action === 'ACCEPTED' ? 'Работы приняты.' : 'Работы возвращены на доработку.');
      await refresh();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Heading trail={<><Link to="/assignments">Задания</Link><span>/</span> Проверка работ</>} title={item?.title ?? 'Задание'}
      description={item && `${item.groups.join(', ')} · дедлайн ${dateTime(item.deadline)} МСК`} />
    {error && <p className="error" role="alert">{error}</p>}
    {item && <div className="panel">
      <p className={s.description}>{item.description}</p>
      <div className={s.sectionHeading}><h2>Работы студентов</h2><button className="button outline" type="button" onClick={() => void refresh()}>Обновить</button></div>
      <div className={s.actions}>
        <button className="button primary" onClick={() => void review('ACCEPTED')} disabled={!selected.length || busy}>Принять выбранные</button>
        <button className="button outline" onClick={() => void review('RETURNED')} disabled={!selected.length || busy}>Вернуть на доработку</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!works.length && <p className="muted">В выбранных группах пока нет студентов.</p>}
      <ul className={s.works}>{works.map(work => <li key={work.studentId}>
        <div className={s.workPerson}><input type="checkbox" aria-label={work.studentName} disabled={work.status !== 'SUBMITTED' || busy}
          checked={selected.includes(work.studentId)} onChange={event => setSelected(ids => event.target.checked ? [...ids, work.studentId] : ids.filter(student => student !== work.studentId))} />
          <div><Link to={`/profiles/${work.studentId}`} className={s.studentLink}>{work.studentName}</Link><small>{work.groupName} · списано {work.deducted} АР</small></div>
        </div>
        <StatusBadge status={work.status} /><Attachments work={work} studentId={work.studentId} assignmentId={id} />
      </li>)}</ul>
    </div>}
  </>;
}

function StudentDetail({ user, id }: { user: Account; id: number }) {
  const [item, setItem] = useState<StudentAssignment>();
  const [rating, setRating] = useState(user.rating);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    const [items, account] = await Promise.all([api<StudentAssignment[]>('/student/assignments'), api<Account>('/me')]);
    const current = items.find(assignment => assignment.id === id);
    if (!current) throw new Error('Задание недоступно.');
    return { current, rating: account.rating };
  }

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await load();
        if (active) { setItem(result.current); setRating(result.rating); }
      } catch (failure) {
        if (active) setError(failureText(failure));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const fields = new FormData(event.currentTarget);
    const file = fields.get('file');
    if (!String(fields.get('link')).trim() && (!(file instanceof File) || !file.size)) {
      setError('Приложите ссылку или файл.');
      return;
    }
    setBusy(true);
    try {
      await api(`/student/assignments/${id}/submit`, { method: 'POST', body: fields });
      const result = await load();
      setItem(result.current);
      setRating(result.rating);
      setNotice('Работа отправлена на проверку.');
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Heading trail={<><Link to="/assignments">Задания</Link><span>/</span> Просмотр</>} title={item?.title ?? 'Задание'}
      description={item && `${item.teacherName} · дедлайн ${dateTime(item.deadline)} МСК`} />
    {error && <p className="error" role="alert">{error}</p>}
    {item && <div className={s.formLayout}>
      <section className="panel">
        <StatusBadge status={item.status} />
        <p className={s.description}>{item.description}</p>
        <Attachments work={item} assignmentId={id} studentId={user.id} />
        {notice && <p role="status">{notice}</p>}
        {(item.status === 'OPEN' || item.status === 'RETURNED' || item.status === 'OVERDUE') && <form className={s.submission} onSubmit={submit}>
          <h2>{item.status === 'RETURNED' ? 'Отправить исправленную работу' : 'Сдать работу'}</h2>
          <label>Ссылка на работу<input name="link" type="url" placeholder="https://" maxLength={2048} /></label>
          <label>Или файл до 10 МБ<input name="file" type="file" /></label>
          <button type="submit" className="button primary" disabled={busy}>{busy ? 'Отправляем…' : 'Сдать работу'} <span aria-hidden="true">→</span></button>
        </form>}
      </section>
      <aside className={s.reminder}><h2>Академический рейтинг</h2><ul><li>Текущий рейтинг: <strong>{rating} АР</strong></li><li>Списано за задание: <strong>{item.deducted} АР</strong></li><li>Лимит задания: <strong>{item.penaltyLimit} АР</strong></li></ul></aside>
    </div>}
  </>;
}
