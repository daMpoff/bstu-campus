import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, post, type RegistrationCatalog, type Role } from './api';
import { GroupPicker, type RegistrationGroup } from './GroupPicker';
import s from './layout.module.css';

export function Registration() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [role, setRole] = useState<Role>('STUDENT');
  const [catalog, setCatalog] = useState<RegistrationCatalog>();
  const [selectedFaculty, setSelectedFaculty] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<RegistrationGroup | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let active = true;
    api<RegistrationCatalog>('/registration/catalog')
      .then(data => { if (active) setCatalog(data); })
      .catch(() => { if (active) setError('Справочники временно недоступны. Обновите страницу.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !catalog || (role === 'STUDENT' && !selectedGroup)) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email')).trim();
    setError('');
    setBusy(true);
    try {
      await post('/registration', {
        role,
        email,
        password: data.get('password'),
        fullName: data.get('fullName'),
        facultyId: role === 'STUDENT' ? Number(selectedFaculty) : null,
        groupId: role === 'STUDENT' ? selectedGroup?.id : null,
        departmentId: role === 'TEACHER' ? Number(data.get('departmentId')) : null,
      });
      navigate('/login', { replace: true, state: { registeredEmail: email, returnTo: state?.returnTo } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось создать аккаунт.');
    } finally {
      setBusy(false);
    }
  }

  function changeFaculty(faculty: string) {
    setSelectedFaculty(faculty);
    setSelectedGroup(null);
  }

  const availableFaculties = new Set(catalog?.groups.map(group => group.facultyId));
  const groups = catalog?.groups.filter(group => group.facultyId === Number(selectedFaculty)) ?? [];

  return <>
    <h1 id="auth-title">Регистрация</h1>
    <form onSubmit={submit} className={`${s.loginForm} ${s.registrationForm}`}>
      {error && <p ref={errorRef} tabIndex={-1} className="error" role="alert">{error}</p>}
      <fieldset className={s.registerRoles}>
        <legend>Роль</legend>
        <div>
          <label><input type="radio" name="role" value="STUDENT" checked={role === 'STUDENT'} onChange={() => setRole('STUDENT')} /> Студент</label>
          <label><input type="radio" name="role" value="TEACHER" checked={role === 'TEACHER'} onChange={() => setRole('TEACHER')} /> Преподаватель</label>
        </div>
      </fieldset>
      <label>ФИО<input name="fullName" autoComplete="name" minLength={2} maxLength={160} required /></label>
      <label>Email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
      <label>Пароль<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} aria-describedby="registration-password-hint" required /></label>
      <small className={`muted ${s.passwordHint}`} id="registration-password-hint">Минимум 8 символов.</small>
      {!catalog && !error && <p role="status" className="muted">Загружаем справочники…</p>}
      {role === 'STUDENT' ? <>
        <label>Факультет или подразделение
          <select value={selectedFaculty} onChange={event => changeFaculty(event.target.value)} disabled={!catalog} required>
            <option value="">Выберите подразделение</option>
            {catalog?.faculties.map(faculty => {
              const hasGroups = availableFaculties.has(faculty.id);
              return <option key={faculty.id} value={faculty.id} disabled={!hasGroups}>
                {faculty.name}{!hasGroups && ' — групп пока нет'}
              </option>;
            })}
          </select>
        </label>
        <GroupPicker key={selectedFaculty} groups={groups} value={selectedGroup} onChange={setSelectedGroup} disabled={!selectedFaculty} />
      </> : <label>Кафедра
        <select name="departmentId" defaultValue="" disabled={!catalog} required>
          <option value="">Выберите кафедру</option>
          {catalog?.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
      </label>}
      <button type="submit" className="button primary" disabled={busy || !catalog}>
        {busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
      </button>
    </form>
    <p className={s.registerPrompt}>Уже есть аккаунт? <Link to="/login" state={{ returnTo: state?.returnTo }}>Войти</Link></p>
  </>;
}
