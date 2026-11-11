import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError, sessionExpiredEvent, type Account, type Role } from './api';
import { AssignmentDetail, AssignmentList, NewAssignment } from './Assignments';
import { Registration } from './Registration';
import { StudentProfile } from './StudentProfile';
import { CabinetPage } from './Cabinet';
import { TeacherDashboard, TeacherRating } from './TeacherCabinet';
import { NewActivity, StudentActivities, TeacherActivities, TeacherActivityDetail } from './Activities';
import { Rewards } from './Rewards';
import { ConfirmEmail, GroupApproval } from './Confirmation';
import { Polls, NewPoll, PollDetail } from './Polls';
import { PersonalFeed } from './PersonalFeed';
import { Admin } from './Admin';
import { Analytics } from './Analytics';
import s from './layout.module.css';

function Glyph({ name }: { name: 'sun' | 'moon' | 'tasks' | 'review' | 'rating' | 'logout' | 'arrow' | 'profile' | 'activities' | 'rewards' | 'poll' | 'feed' | 'approval' | 'settings' }) {
  const paths = {
    sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z',
    tasks: 'M5 4h14v16H5zM8 12l2 2 5-5M9 4V2m6 2V2',
    review: 'M6 3h8l4 4v14H6zM14 3v5h4m-9 4h6m-6 4h6',
    rating: 'M4 20h16M7 16v-4m5 4V8m5 8V4',
    activities: 'M5 5h14v15H5zM8 3v4m8-4v4M5 10h14m-10 4h6m-3-2v4',
    rewards: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3z',
    logout: 'M10 4H4v16h6m4-12 4 4-4 4m-6-4h10',
    arrow: 'M4 12h15m-6-6 6 6-6 6',
    profile: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a7 7 0 0 1 14 0v2',
    poll: 'M4 4h16v13H9l-5 3V4Zm4 8h2m2 0h2m2 0h1',
    feed: 'M5 6h14M5 12h14M5 18h14M2 6h.1M2 12h.1M2 18h.1',
    approval: 'M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 20v-2a5 5 0 0 1 9-3m2 2 3 3 6-7',
    settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function cabinetPath(role: Role) {
  if (role === 'ADMIN') return '/admin';
  return role === 'STUDENT' ? '/profile' : '/assignments';
}

const cabinetRoute = /^\/(?:profile|profiles\/[^/]+|assignments(?:\/[^/]+)?|activities(?:\/[^/]+)?|polls(?:\/[^/]+)?|review|rating|rewards|feed|admin|analytics|group-approval)\/?$/i;
const sharedRoute = /^\/(?:profiles\/[^/]+|rewards)\/?$/i;

function afterLogin(role: Role, returnTo: unknown) {
  if (typeof returnTo === 'string' && cabinetRoute.test(returnTo)) {
    return returnTo;
  }
  return cabinetPath(role);
}

export function App() {
  const [account, setAccount] = useState<Account | null>();
  const [theme, setTheme] = useState(() => localStorage.getItem('campus-theme') ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const { pathname, state } = useLocation();
  const inCabinet = Boolean(account) && cabinetRoute.test(pathname);
  const cabinet = account ? cabinetPath(account.role) : '/login';

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

  useEffect(() => {
    const expireSession = () => setAccount(null);
    window.addEventListener(sessionExpiredEvent, expireSession);
    return () => window.removeEventListener(sessionExpiredEvent, expireSession);
  }, []);

  const needsGroupApproval = account?.role === 'STUDENT' && !account.groupVerified;
  useEffect(() => {
    if (!needsGroupApproval) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void api<Account>('/me', { signal: controller.signal }).then(user => {
        if (!controller.signal.aborted && user.groupVerified) setAccount(current => current?.id === user.id ? user : current);
      }).catch(() => {});
    }, 6000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [needsGroupApproval]);

  async function logout() {
    await api('/logout', { method: 'POST' });
    window.location.replace('/');
  }

  const loadingCabinet = <p className={s.loading} role="status">Загружаем кабинет…</p>;
  const authPage = account === undefined ? loadingCabinet
    : account ? <Navigate to={afterLogin(account.role, state?.returnTo)} replace />
      : <AuthLayout dark={theme === 'dark'} />;

  const themeToggle = <button className={s.theme} type="button"
    aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
    <Glyph name={theme === 'dark' ? 'sun' : 'moon'} />
  </button>;

  function requireAccount(content: (user: Account) => ReactNode, profile = false) {
    if (account === undefined) return loadingCabinet;
    if (!account) return <Navigate to="/login" replace state={{ returnTo: pathname }} />;
    if (account.role === 'ADMIN' && !sharedRoute.test(pathname) && !/^\/admin\/?$/i.test(pathname)) {
      return <Navigate to="/admin" replace />;
    }
    const teacherOverview = account.role === 'TEACHER' && /^\/(assignments|review|rating)\/?$/i.test(pathname);
    const subtitle = account.role === 'TEACHER'
      ? account.departmentName ? `Кафедра · ${account.departmentName}` : 'Преподаватель БГТУ'
      : account.role === 'ADMIN' ? 'Администратор' : [account.facultyName, account.groupName].filter(Boolean).join(' · ');
    return <Workspace user={account} onLogout={logout}>
      {profile ? content(account) : <CabinetPage name={account.fullName} subtitle={subtitle} themeToggle={themeToggle}
        nameHeading={teacherOverview}>{content(account)}</CabinetPage>}
    </Workspace>;
  }

  return <>
    {!inCabinet && <header className={s.header}>
      <div className={s.headerInner}>
        <Brand />
        <div className={s.headerActions}>
          {themeToggle}
          <Link className="button outline" to={cabinet} state={account ? undefined : state}>
            {account ? 'Кабинет' : 'Войти'} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </header>}
    <Routes>
      <Route path="/" element={<Home cabinet={cabinet} signedIn={Boolean(account)} />} />
      <Route element={authPage}>
        <Route path="/login" element={<Login onLogin={setAccount} />} />
        <Route path="/register" element={<Registration />} />
      </Route>
      <Route element={<AuthLayout dark={theme === 'dark'} />}>
        <Route path="/confirm-email" element={<ConfirmEmail />} />
      </Route>
      <Route path="/assignments" element={requireAccount(user => user.role === 'TEACHER' ? <TeacherDashboard /> : <AssignmentList user={user} />)} />
      <Route path="/assignments/new" element={requireAccount(user => user.role === 'TEACHER' ? <NewAssignment /> : <Navigate to={cabinet} replace />)} />
      <Route path="/assignments/:id" element={requireAccount(user => <AssignmentDetail user={user} />)} />
      <Route path="/review" element={requireAccount(user => user.role === 'TEACHER' ? <TeacherDashboard reviewOnly /> : <Navigate to={cabinet} replace />)} />
      <Route path="/rating" element={requireAccount(user => user.role === 'TEACHER' ? <TeacherRating /> : <Navigate to={cabinet} replace />)} />
      <Route path="/activities" element={requireAccount(user => user.role === 'TEACHER' ? <TeacherActivities /> : <StudentActivities />)} />
      <Route path="/activities/new" element={requireAccount(user => user.role === 'TEACHER' ? <NewActivity /> : <Navigate to="/activities" replace />)} />
      <Route path="/activities/:id" element={requireAccount(user => user.role === 'TEACHER' ? <TeacherActivityDetail /> : <Navigate to="/activities" replace />)} />
      <Route path="/rewards" element={requireAccount(() => <Rewards />)} />
      <Route path="/feed" element={requireAccount(() => <PersonalFeed />)} />
      <Route path="/polls" element={requireAccount(user => <Polls teacher={user.role === 'TEACHER'} />)} />
      <Route path="/polls/new" element={requireAccount(user => user.role === 'TEACHER' ? <NewPoll /> : <Navigate to="/polls" replace />)} />
      <Route path="/polls/:id" element={requireAccount(user => <PollDetail teacher={user.role === 'TEACHER'} />)} />
      <Route path="/group-approval" element={requireAccount(user => user.role === 'TEACHER' ? <GroupApproval /> : <Navigate to={cabinet} replace />)} />
      <Route path="/analytics" element={requireAccount(user => user.role === 'TEACHER' ? <Analytics /> : <Navigate to={cabinet} replace />)} />
      <Route path="/admin" element={requireAccount(user => user.role === 'ADMIN' ? <Admin /> : <Navigate to={cabinet} replace />)} />
      <Route path="/profile" element={requireAccount(user => user.role === 'STUDENT'
        ? <StudentProfile user={user} themeToggle={themeToggle} />
        : <Navigate to={cabinet} replace />, true)} />
      <Route path="/profiles/:id" element={requireAccount(user => <StudentProfile user={user} themeToggle={themeToggle} />, true)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>;
}

function Brand({ cabinet = false }: { cabinet?: boolean }) {
  return <Link className={s.brand} to="/" aria-label="БГТУ, главная">
    <img className={s.brandLogo} src="/images/bgtu-logo.svg" alt="" width={48} height={48} />
    <span><strong>БГТУ</strong><small>{cabinet ? 'Университетская среда' : 'УНИВЕРСИТЕТСКАЯ СРЕДА'}</small></span>
  </Link>;
}

function Home({ cabinet, signedIn }: { cabinet: string; signedIn: boolean }) {
  return <main className={s.home}>
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={s.heroContent}>
        <h1 id="hero-title">БГТУ</h1>
        <p>Университетская среда</p>
        <div className={s.heroDescription}>Задания и академический рейтинг в одном месте.</div>
        <Link to={cabinet} className={`button ${s.heroAction}`}>
          {signedIn ? 'Открыть кабинет' : 'Войти'}
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
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<boolean>('/demo', { signal: controller.signal }).then(enabled => {
      if (!controller.signal.aborted) setDemo(enabled);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
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
    {state?.emailConfirmed
      ? <p className="muted" role="status">Email подтверждён. Войдите в кабинет.</p>
      : registeredEmail
      ? <p className="muted" role="status">Аккаунт создан. Подтвердите email по ссылке из письма.</p>
      : <p className="muted">Укажите email и пароль.</p>}
    <form onSubmit={submit} className={s.loginForm}>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'} <span aria-hidden="true">→</span></button>
    </form>
    <p className={s.registerPrompt}>Первый раз в системе? <Link to="/register" state={{ returnTo: state?.returnTo }}>Зарегистрироваться</Link></p>
    {(registeredEmail || error) && <p className={s.registerPrompt}><Link to="/confirm-email" state={{ registeredEmail: email, returnTo: state?.returnTo }}>Запросить письмо подтверждения</Link></p>}
    {demo && <div className={s.demo}><small>ДЕМО-АККАУНТЫ</small><div>
      <button className="button outline" onClick={() => fillDemo('teacher')}>Преподаватель</button>
      <button className="button outline" onClick={() => fillDemo('student')}>Студент</button>
      <button className="button outline" onClick={() => fillDemo('admin')}>Администратор</button>
    </div></div>}
  </>;
}

function Workspace({ user, children, onLogout }: {
  user: Account; children: ReactNode; onLogout: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  return <div className={s.cabinet}>
    <aside className={s.cabinetSidebar} data-cabinet-sidebar>
      <Brand cabinet />
      <nav aria-label="Кабинет">
        {user.role === 'ADMIN' && <NavLink to="/admin"><Glyph name="settings" /> Администрирование</NavLink>}
        {user.role === 'STUDENT' && <NavLink to="/profile"><Glyph name="profile" /> Профиль</NavLink>}
        {user.role !== 'ADMIN' && <NavLink to="/assignments"><Glyph name="tasks" /> Задания</NavLink>}
        {user.role === 'TEACHER' && <>
          <NavLink to="/review"><Glyph name="review" /> Проверка работ</NavLink>
          <NavLink to="/rating"><Glyph name="rating" /> Рейтинг студентов</NavLink>
          <NavLink to="/analytics"><Glyph name="rating" /> Аналитика</NavLink>
          <NavLink to="/group-approval"><Glyph name="approval" /> Подтверждение группы</NavLink>
        </>}
        {user.role !== 'ADMIN' && <>
          <NavLink to="/activities"><Glyph name="activities" /> Активности</NavLink>
          <NavLink to="/polls"><Glyph name="poll" /> Опросы</NavLink>
          <NavLink to="/feed"><Glyph name="feed" /> Мои события</NavLink>
        </>}
        <NavLink to="/rewards"><Glyph name="rewards" /> Лента наград</NavLink>
      </nav>
      <button type="button" className={s.logout} aria-label="Выйти"
        onClick={() => onLogout().catch(() => setError('Не удалось выйти. Попробуйте ещё раз.'))}>
        <Glyph name="logout" /> <span>Выйти</span>
      </button>
      {error && <p role="alert">{error}</p>}
    </aside>
    {children}
  </div>;
}
