import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { post, type Group, type Role } from './api';
import { GroupPicker, studyForms } from './GroupPicker';
import { GroupLeadership, type LeadershipData } from './GroupLeadership';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import approval from './group-approval.module.css';
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
type ApprovalGroup = Group & {
  facultyId: number | null; facultyName: string | null; studyForm: string | null; pendingCount: number;
};
const defaultFilters = { faculty: '', form: '', pendingOnly: false };
const requestPlural = new Intl.PluralRules('ru-RU');

function matchesFilters(group: ApprovalGroup, filters: typeof defaultFilters) {
  return (!filters.faculty || String(group.facultyId) === filters.faculty)
    && (!filters.form || (group.studyForm ?? 'unspecified') === filters.form)
    && (!filters.pendingOnly || group.pendingCount > 0);
}

function requestCount(group: ApprovalGroup) {
  if (!group.pendingCount) return undefined;
  const noun = { one: 'заявка', few: 'заявки', many: 'заявок', other: 'заявки', two: 'заявки', zero: 'заявок' };
  return `${group.pendingCount} ${noun[requestPlural.select(group.pendingCount)]}`;
}

export function GroupApproval({ role }: { role: Role }) {
  const scope = '/' + role.toLowerCase();
  const { data: groups, error, reload } = useCabinetResource<ApprovalGroup[]>(`${scope}/group-approval/groups`);
  const [groupId, setGroupId] = useState<number>();
  const [filters, setFilters] = useState(defaultFilters);
  const group = (role === 'STUDENT' ? groups?.[0] : groups?.find(item => item.id === groupId)) ?? null;
  const visibleGroups = groups?.filter(item => matchesFilters(item, filters)) ?? [];
  const faculties = new Map<number, string>();
  for (const item of groups ?? []) {
    if (item.facultyId !== null && item.facultyName) faculties.set(item.facultyId, item.facultyName);
  }
  const facultyOptions = [...faculties].sort((a, b) => a[1].localeCompare(b[1], 'ru-RU'));
  const groupPath = group ? `${scope}/groups/${group.id}` : '';
  const noGroups = role === 'TEACHER' ? 'Администратор пока не назначил вам группы.'
    : role === 'STUDENT' ? 'У вас нет активного назначения старостой.' : 'В справочнике пока нет групп.';

  function updateFilters(next: typeof defaultFilters) {
    setFilters(next);
    if (group && !matchesFilters(group, next)) setGroupId(undefined);
  }

  return <div className={approval.page}>
    <h1>Подтверждение группы</h1>
    {error && <div className={approval.filterActions}>
      <p className="error" role="alert">{error}</p>
      <button type="button" className="button outline" onClick={reload}>Повторить</button>
    </div>}
    {!error && !groups && <p role="status" className="muted">Загружаем группы…</p>}
    {groups?.length === 0 && <p className={`panel ${cabinet.section} muted`}>{noGroups}</p>}
    {role !== 'STUDENT' && Boolean(groups?.length) &&
    <section className={`panel ${cabinet.section} ${approval.panel}`} aria-label="Поиск и фильтры групп">
      <div className={approval.filters}>
        <GroupPicker groups={visibleGroups} value={group} onChange={item => setGroupId(item?.id)}
          disabled={!groups} required={false} placeholder="Введите часть шифра группы" className={approval.picker}
          optionDetail={requestCount} />
        <label>Факультет или институт
          <select value={filters.faculty} disabled={!groups}
            onChange={event => updateFilters({ ...filters, faculty: event.target.value })}>
            <option value="">Все подразделения</option>
            {facultyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>Форма обучения
          <select value={filters.form} disabled={!groups}
            onChange={event => updateFilters({ ...filters, form: event.target.value })}>
            <option value="">Все формы</option>
            {studyForms.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            {groups?.some(item => item.studyForm === null) && <option value="unspecified">Не указана</option>}
          </select>
        </label>
      </div>
      <div className={approval.filterActions}>
        <label className={approval.pendingFilter}>
          <input type="checkbox" checked={filters.pendingOnly} disabled={!groups}
            onChange={event => updateFilters({ ...filters, pendingOnly: event.target.checked })} />
          Только с заявками
        </label>
        {(filters.faculty || filters.form || filters.pendingOnly) && <button type="button" className="button outline"
          onClick={() => updateFilters(defaultFilters)}>Сбросить фильтры</button>}
      </div>
      {visibleGroups.length === 0 && <p className="muted">По этим фильтрам групп нет.</p>}
    </section>}
    {group && (role === 'STUDENT'
      ? <PendingStudents key={group.id} group={group} path={`${groupPath}/pending-students`} reloadGroups={reload} />
      : <ManagedGroup key={group.id} group={group} path={groupPath} admin={role === 'ADMIN'} reloadGroups={reload} />)}
  </div>;
}

function ManagedGroup({ group, path, admin, reloadGroups }: {
  group: ApprovalGroup; path: string; admin: boolean; reloadGroups: () => void;
}) {
  const leadership = useCabinetResource<LeadershipData>(`${path}/leadership`);
  return <>
    <PendingStudents group={group} path={`${path}/pending-students`}
      reloadGroups={() => { reloadGroups(); leadership.reload(); }} />
    <GroupLeadership path={path} admin={admin} {...leadership} />
  </>;
}

function PendingStudents({ group, path, reloadGroups }: { group: ApprovalGroup; path: string; reloadGroups: () => void }) {
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
      reloadGroups();
      setBusy(false);
    }
  }

  return <section className={`panel ${cabinet.section} ${approval.panel}`} aria-labelledby="pending-students-title">
    <h2 id="pending-students-title">Заявки · {group.name}</h2>
    {!students && !error && <p role="status" className="muted">Загружаем заявки…</p>}
    {(failure || error) && <p role="alert" className="error">{failure || error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {students?.length === 0 && <p className="muted">В этой группе нет заявок.</p>}
    {Boolean(students?.length) && <ul className={approval.requests}>
      {students?.map(student => <li key={student.id}>
        <strong>{student.fullName}</strong>
        <button className="button outline" type="button" disabled={busy}
          aria-label={`Подтвердить группу · ${student.fullName}`} onClick={() => void approve(student)}>Подтвердить</button>
      </li>)}
    </ul>}
  </section>;
}
