import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { post, type Group } from './api';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import form from './assignments.module.css';
import layout from './layout.module.css';

export function ConfirmEmail() {
  const { hash } = useLocation();
  const token = hash.slice(1);
  return <EmailConfirmationForm key={token} token={token} />;
}

function EmailConfirmationForm({ token }: { token: string }) {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [resend, setResend] = useState(!token);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (resend) {
        await post('/registration/resend-email', { email });
        setNotice('Если адрес зарегистрирован и ждёт подтверждения, письмо придёт на почту.');
      } else {
        await post('/registration/confirm-email', { token });
        navigate('/login', { replace: true, state: { emailConfirmed: true, returnTo: state?.returnTo } });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось обработать запрос.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <h1 id="auth-title">Подтверждение email</h1>
    <p className="muted">{resend ? 'Укажите адрес, который использовали при регистрации.' : 'Подтвердите адрес, чтобы войти в кабинет.'}</p>
    <form onSubmit={submit} className={layout.loginForm}>
      {resend && <label>Email<input name="email" type="email" autoComplete="username"
        defaultValue={typeof state?.registeredEmail === 'string' ? state.registeredEmail : ''} maxLength={254} required /></label>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="button primary" disabled={busy}>{resend ? 'Отправить письмо' : 'Подтвердить email'}</button>
      {!resend && error && <button type="button" className="button outline" onClick={() => { setResend(true); setError(''); }}>
        Запросить новое письмо
      </button>}
    </form>
    <p className={layout.registerPrompt}><Link to="/login" state={{ returnTo: state?.returnTo }}>Войти в кабинет</Link></p>
  </>;
}

type PendingStudent = { id: number; fullName: string };

export function GroupApproval() {
  const { data: groups, error } = useCabinetResource<Group[]>('/teacher/groups');
  const [groupId, setGroupId] = useState('');
  return <>
    <h1>Подтверждение группы</h1>
    <section className={`panel ${cabinet.section}`} aria-label="Подтверждение студентов">
      <label className={form.field}><span>Учебная группа</span>
        <select value={groupId} disabled={!groups} onChange={event => setGroupId(event.target.value)}>
          <option value="">Выберите группу</option>
          {groups?.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {groupId && <PendingStudents key={groupId} groupId={groupId} />}
    </section>
  </>;
}

function PendingStudents({ groupId }: { groupId: string }) {
  const path = `/teacher/groups/${groupId}/pending-students`;
  const { data: students, error, reload } = useCabinetResource<PendingStudent[]>(path);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [failure, setFailure] = useState('');

  async function approve(student: PendingStudent) {
    setBusy(true);
    setFeedback('');
    setFailure('');
    try {
      await post(`${path}/${student.id}`, {});
      setFeedback(`Группа подтверждена · ${student.fullName}`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Не удалось подтвердить группу.');
    } finally {
      reload();
      setBusy(false);
    }
  }

  return <>
    {!students && !error && <p role="status" className="muted">Загружаем заявки…</p>}
    {(failure || error) && <p role="alert" className="error">{failure || error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {students?.length === 0 && <p className="muted">В этой группе нет заявок.</p>}
    {Boolean(students?.length) && <ul className={form.works}>
      {students?.map(student => <li key={student.id}>
        <strong>{student.fullName}</strong>
        <button className="button outline" type="button" disabled={busy}
          aria-label={`Подтвердить группу · ${student.fullName}`} onClick={() => void approve(student)}>Подтвердить</button>
      </li>)}
    </ul>}
  </>;
}
