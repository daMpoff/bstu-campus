import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type Account } from './api';
import { AssignmentDetail, AssignmentList, NewAssignment } from './Assignments';
import { Registration } from './Registration';
import s from './layout.module.css';

function Glyph({ name }: { name: 'sun' | 'moon' | 'tasks' | 'review' | 'logout' | 'arrow' }) {
  const paths = {
    sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z',
    tasks: 'M5 4h14v16H5zM8 12l2 2 5-5M9 4V2m6 2V2',
    review: 'M6 3h8l4 4v14H6zM14 3v5h4m-9 4h6m-6 4h6',
    logout: 'M10 4H4v16h6m4-12 4 4-4 4m-6-4h10',
    arrow: 'M4 12h15m-6-6 6 6-6 6',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function App() {
  const [account, setAccount] = useState<Account | null>();
  const [theme, setTheme] = useState(() => localStorage.getItem('campus-theme') ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const canvasColor = getComputedStyle(root).getPropertyValue('--paper').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvasColor);
    localStorage.setItem('campus-theme', theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    api<Account>('/me').then(user => { if (active) setAccount(current => current ?? user); })
      .catch(() => { if (active) setAccount(current => current === undefined ? null : current); });
    return () => { active = false; };
  }, []);

  async function logout() {
    await api('/logout', { method: 'POST' });
    setAccount(null);
    navigate('/');
  }

  const requireAccount = (content: (user: Account) => ReactNode) => account === undefined
    ? <p className={s.loading}>Загружаем кабинет…</p>
    : account ? <Workspace user={account} onLogout={logout}>{content(account)}</Workspace>
      : <Navigate to="/login" replace />;

  return <>
    <header className={s.header}>
      <div className={s.headerInner}>
        <Link className={s.brand} to="/" aria-label="БГТУ, главная">
          <img className={s.brandLogo} src="/images/bgtu-logo.svg" alt="" width={48} height={48} />
          <span><strong>БГТУ</strong><small>УНИВЕРСИТЕТСКАЯ СРЕДА</small></span>
        </Link>
        <div className={s.headerActions}>
          <button className={s.theme} type="button" aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Glyph name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <Link className="button outline" to={account ? '/assignments' : '/login'}>{account ? 'Кабинет' : 'Войти'} <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </header>
    <Routes>
      <Route path="/" element={<Home account={account} />} />
      <Route element={account ? <Navigate to="/assignments" replace /> : <AuthLayout dark={theme === 'dark'} />}>
        <Route path="/login" element={<Login onLogin={setAccount} />} />
        <Route path="/register" element={<Registration />} />
      </Route>
      <Route path="/assignments" element={requireAccount(user => <AssignmentList user={user} />)} />
      <Route path="/assignments/new" element={requireAccount(user => user.role === 'TEACHER' ? <NewAssignment /> : <Navigate to="/assignments" replace />)} />
      <Route path="/assignments/:id" element={requireAccount(user => <AssignmentDetail user={user} />)} />
      <Route path="/review" element={requireAccount(user => user.role === 'TEACHER' ? <AssignmentList user={user} reviewOnly /> : <Navigate to="/assignments" replace />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>;
}

function Home({ account }: { account?: Account | null }) {
  const destination = account ? '/assignments' : '/login';
  return <main className={s.home}>
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={s.heroContent}>
        <h1 id="hero-title">БГТУ</h1>
        <p>Университетская среда</p>
        <div className={s.heroDescription}>Задания и академический рейтинг в одном месте.</div>
        <Link to={destination} className={`button ${s.heroAction}`}>
          {account ? 'Открыть кабинет' : 'Войти'}
          <Glyph name="arrow" />
        </Link>
      </div>
      <span className={s.address}>БРЯНСК · ИНСТИТУТСКАЯ, 16</span>
    </section>
    <p className={s.photoCredit}>
      Фото <a href="https://commons.wikimedia.org/wiki/File:Мужская_гимназияя.jpg">OlgaPonkrashova</a>
      {' · '}<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
    </p>
    <section className={s.process} aria-labelledby="process-title">
      <h2 id="process-title">Как устроена система</h2>
      <div className={s.processSteps}>
        <div className={s.processStep}>
          <h3>Назначение задания</h3>
          <p>Преподаватель выбирает группу, задаёт срок сдачи и лимит списания рейтинга.</p>
        </div>
        <div className={s.processStep}>
          <h3>Сдача и проверка</h3>
          <p>Студент отправляет ссылку или файл. Преподаватель принимает работу или возвращает её на доработку.</p>
        </div>
        <div className={s.processStep}>
          <h3>Академический рейтинг</h3>
          <p>За просрочку списываются баллы в пределах лимита. Сдача работы останавливает списание.</p>
        </div>
      </div>
    </section>
    <footer className={s.footer}>БГТУ · Университетская среда</footer>
  </main>;
}

function AuthLayout({ dark }: { dark: boolean }) {
  const { pathname } = useLocation();
  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [pathname]);

  return <main className={s.authPage}>
    <div className={s.authVisual}>
      <img src={dark ? '/images/bgtu-login-night.webp' : '/images/bgtu-login.webp'}
        alt="Осенняя аллея вдоль корпуса БГТУ" width={957} height={1277} />
    </div>
    <section ref={panel} className={s.authSide} aria-labelledby="auth-title">
      <div className={s.authContent}>
        <Outlet />
      </div>
    </section>
  </main>;
}

function Login({ onLogin }: { onLogin: (user: Account) => void }) {
  const { state } = useLocation();
  const registeredEmail = typeof state?.registeredEmail === 'string' ? state.registeredEmail : '';
  const [email, setEmail] = useState(registeredEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', { method: 'POST', body: new URLSearchParams({ email, password }) });
      onLogin(await api<Account>('/me'));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось связаться с сервером.');
    } finally {
      setBusy(false);
    }
  }
  function fillDemo(role: string) {
    setEmail(role + '@bgtu.test');
    setPassword('demo2026');
    setError('');
  }
  return <>
    <h1 id="auth-title">Личный кабинет</h1>
    {registeredEmail
      ? <p className="muted" role="status">Аккаунт создан. Введите пароль, чтобы войти.</p>
      : <p className="muted">Укажите email и пароль.</p>}
    <form onSubmit={submit} className={s.loginForm}>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'} <span aria-hidden="true">→</span></button>
    </form>
    <p className={s.registerPrompt}>Первый раз в системе? <Link to="/register">Зарегистрироваться</Link></p>
    <div className={s.demo}><small>ДЕМО-АККАУНТЫ</small><div>
      <button className="button outline" onClick={() => fillDemo('teacher')}>Преподаватель</button>
      <button className="button outline" onClick={() => fillDemo('student')}>Студент</button>
    </div></div>
  </>;
}

function Workspace({ user, children, onLogout }: { user: Account; children: ReactNode; onLogout: () => Promise<void> }) {
  const [error, setError] = useState('');
  const initials = user.fullName.split(' ').map(word => word[0]).slice(0, 2).join('');
  return <main className={s.workspace}>
    <aside className={s.sidebar}>
      <div className={s.person}><span>{initials}</span><div><strong>{user.fullName}</strong><small>{user.role === 'TEACHER' ? 'Преподаватель БГТУ' : 'Студент · ' + user.groupName}</small></div></div>
      <nav aria-label="Кабинет">
        <NavLink to="/assignments"><Glyph name="tasks" /> Задания</NavLink>
        {user.role === 'TEACHER' && <NavLink to="/review"><Glyph name="review" /> Проверка работ</NavLink>}
      </nav>
      <button type="button" className={s.logout} onClick={() => onLogout().catch(() => setError('Не удалось выйти. Попробуйте ещё раз.'))}><Glyph name="logout" /> Выйти</button>
      {error && <p role="alert">{error}</p>}
    </aside>
    <div className={s.workspaceContent}>{children}</div>
  </main>;
}
