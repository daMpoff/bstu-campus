import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { post, type Group, type Role } from './api';
import { normalizeGroupSearch, studyForms } from './GroupPicker';
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

function revealGroupHeading(heading: HTMLHeadingElement | null) {
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView({ block: 'start' });
}

export function GroupApproval({ role }: { role: Role }) {
  const scope = '/' + role.toLowerCase();
  const { data: groups, error, reload } = useCabinetResource<ApprovalGroup[]>(`${scope}/group-approval/groups`);
  const [groupId, setGroupId] = useState<number>();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(defaultFilters);
  const groupHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterSelection = useRef(false);
  const group = (role === 'STUDENT' ? groups?.[0] : groups?.find(item => item.id === groupId)) ?? null;
  const query = normalizeGroupSearch(search);
  const visibleGroups = groups?.filter(item => matchesFilters(item, filters)
    && normalizeGroupSearch(item.name).includes(query)) ?? [];
  const faculties = new Map<number, string>();
  for (const item of groups ?? []) {
    if (item.facultyId !== null && item.facultyName) faculties.set(item.facultyId, item.facultyName);
  }
  const facultyOptions = [...faculties].sort((a, b) => a[1].localeCompare(b[1], 'ru-RU'));
  const groupPath = group ? `${scope}/groups/${group.id}` : '';
  const noGroups = role === 'TEACHER' ? 'Администратор пока не назначил вам группы.'
    : role === 'STUDENT' ? 'У вас нет активного назначения старостой.' : 'В справочнике пока нет групп.';

  useLayoutEffect(() => {
    if (!focusAfterSelection.current) return;
    focusAfterSelection.current = false;
    revealGroupHeading(groupHeading.current);
  }, [group?.id]);

  function updateSearch(next: string) {
    setSearch(next);
    if (group && !normalizeGroupSearch(group.name).includes(normalizeGroupSearch(next))) setGroupId(undefined);
  }

  function chooseGroup(id: number) {
    if (!matchMedia('(min-width: 1000px)').matches) {
      if (group?.id === id) revealGroupHeading(groupHeading.current);
      else focusAfterSelection.current = true;
    }
    setGroupId(id);
  }

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
    {Boolean(groups?.length) && <div className={role === 'STUDENT' ? approval.details : approval.workspace}>
      {role !== 'STUDENT' && <section className={`panel ${cabinet.section} ${approval.directory}`} aria-labelledby="approval-groups-title">
        <h2 id="approval-groups-title">Учебные группы</h2>
        <label className={approval.search}>Поиск группы
          <input type="search" value={search} placeholder="Например, ИВТ-24" onChange={event => updateSearch(event.target.value)} />
        </label>
        <label className={approval.pendingFilter}>
          <input type="checkbox" checked={filters.pendingOnly}
            onChange={event => updateFilters({ ...filters, pendingOnly: event.target.checked })} />
          Только с заявками
        </label>
        <details className={approval.filterDisclosure}>
          <summary>Фильтры</summary>
          <div className={approval.filters}>
            <label>Факультет или институт
              <select value={filters.faculty} onChange={event => updateFilters({ ...filters, faculty: event.target.value })}>
                <option value="">Все подразделения</option>
                {facultyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>Форма обучения
              <select value={filters.form} onChange={event => updateFilters({ ...filters, form: event.target.value })}>
                <option value="">Все формы</option>
                {studyForms.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                {groups?.some(item => item.studyForm === null) && <option value="unspecified">Не указана</option>}
              </select>
            </label>
            <button type="button" className="button outline"
              disabled={!filters.faculty && !filters.form && !filters.pendingOnly}
              onClick={() => updateFilters(defaultFilters)}>Сбросить фильтры</button>
          </div>
        </details>
        {visibleGroups.length ? <ul className={approval.groupList} aria-label="Группы">
          {visibleGroups.map(item => {
            const count = requestCount(item);
            const countId = `approval-count-${item.id}`;
            return <li key={item.id}>
              <button type="button" className={approval.groupRow} aria-pressed={group?.id === item.id}
                aria-label={item.name} aria-describedby={count ? countId : undefined} onClick={() => chooseGroup(item.id)}>
                <span>{item.name}</span>
                {count && <span id={countId} className={approval.count}>{count}</span>}
              </button>
            </li>;
          })}
        </ul> : <p className={`muted ${approval.emptyList}`}>{query || filters.faculty || filters.form
          ? 'Группы не найдены. Измените поиск или фильтры.' : 'В доступных группах нет заявок.'}</p>}
      </section>}
      <div className={approval.details}>
        {group ? <>
          <header className={approval.groupHeading}>
            <h2 ref={groupHeading} tabIndex={-1}>{group.name}</h2>
            {group.facultyName && <p className="muted">{group.facultyName}</p>}
          </header>
          {role === 'STUDENT'
            ? <PendingStudents key={group.id} path={`${groupPath}/pending-students`} reloadGroups={reload} />
            : <ManagedGroup key={group.id} path={groupPath} admin={role === 'ADMIN'} reloadGroups={reload} />}
        </> : <section className={`panel ${cabinet.section} ${approval.prompt}`}>
          <h2>Выберите группу</h2>
          <p className="muted">Откройте группу из списка, чтобы увидеть заявки и назначить старосту.</p>
        </section>}
      </div>
    </div>}
  </div>;
}

function ManagedGroup({ path, admin, reloadGroups }: {
  path: string; admin: boolean; reloadGroups: () => void;
}) {
  const leadership = useCabinetResource<LeadershipData>(`${path}/leadership`);
  return <>
    <PendingStudents path={`${path}/pending-students`}
      reloadGroups={() => { reloadGroups(); leadership.reload(); }} />
    <GroupLeadership path={path} admin={admin} {...leadership} />
  </>;
}

function PendingStudents({ path, reloadGroups }: { path: string; reloadGroups: () => void }) {
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
    <h2 id="pending-students-title">Заявки</h2>
    {!students && !error && <p role="status" className="muted">Загружаем заявки…</p>}
    {(failure || error) && <p role="alert" className="error">{failure || error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {students?.length === 0 && <p className="muted">В этой группе нет заявок.</p>}
    {Boolean(students?.length) && <ul className={approval.requests}>
      {students?.map(student => <li key={student.id}>
        <strong>{student.fullName}</strong>
        <button className="button primary" type="button" disabled={busy}
          aria-label={`Подтвердить группу · ${student.fullName}`} onClick={() => void approve(student)}>Подтвердить</button>
      </li>)}
    </ul>}
  </section>;
}
