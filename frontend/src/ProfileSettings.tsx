import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Account } from './api';
import { CabinetAvatar } from './Cabinet';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import s from './settings.module.css';

type TelegramStatus = { configured: boolean; botUsername: string | null; connected: boolean };
type PairingCode = { code: string; expiresAt: string };

const codeTime = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
});

type ProfileSettingsProps = { account: Account; onAvatarChange: (account: Account) => void };
const maxPhotoSize = 5 * 1024 * 1024;
const photoFormats = ['image/jpeg', 'image/png'];

function ProfilePhoto({ account, onAvatarChange }: ProfileSettingsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ file: File; url: string }>();
  const [pending, setPending] = useState<'save' | 'delete'>();
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => () => {
    if (draft) URL.revokeObjectURL(draft.url);
  }, [draft]);

  function clearSelection() {
    if (input.current) input.current.value = '';
    setDraft(undefined);
  }

  function choosePhoto(file?: File) {
    setError('');
    setFeedback('');
    if (!file) {
      clearSelection();
      return;
    }
    if (file.size > maxPhotoSize || (file.type && !photoFormats.includes(file.type))) {
      clearSelection();
      setError('Выберите фото в формате JPEG или PNG размером до 5 МБ.');
      return;
    }
    setDraft({ file, url: URL.createObjectURL(file) });
  }

  async function changePhoto(file?: File) {
    if (pending) return;
    setPending(file ? 'save' : 'delete');
    setError('');
    setFeedback('');
    const body = file ? new FormData() : undefined;
    if (file) body?.set('file', file);
    try {
      const updated = await api<Account>('/me/avatar', { method: file ? 'PUT' : 'DELETE', body });
      onAvatarChange(updated);
      clearSelection();
      setFeedback(file ? 'Фото сохранено.' : 'Фото удалено.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось изменить фото.');
    } finally {
      setPending(undefined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft) void changePhoto(draft.file);
  }

  return <section className={`panel ${cabinet.section} ${s.panel}`} aria-labelledby="profile-photo-title">
    <h2 id="profile-photo-title">Фото профиля</h2>
    <form className={s.photoForm} onSubmit={submit}>
      <CabinetAvatar name={account.fullName} avatarUrl={draft?.url ?? account.avatarUrl} className={s.photoAvatar} />
      <div className={s.photoControls}>
        <label htmlFor="profile-photo-file">Выбрать фото</label>
        <input type="file" id="profile-photo-file" ref={input} accept={photoFormats.join(',')} disabled={Boolean(pending)}
          aria-describedby="profile-photo-hint" onChange={event => choosePhoto(event.currentTarget.files?.[0])} />
        <p className={s.hint} id="profile-photo-hint">JPEG или PNG, до 5 МБ.</p>
        <div className={s.actions}>
          <button className="button primary" type="submit" disabled={!draft || Boolean(pending)}>
            {pending === 'save' ? 'Сохраняем…' : 'Сохранить фото'}
          </button>
          {draft && <button className="button outline" type="button" onClick={() => choosePhoto()} disabled={Boolean(pending)}>
            Отменить выбор
          </button>}
          {!draft && account.avatarUrl && <button className="button outline" type="button" onClick={() => void changePhoto()} disabled={Boolean(pending)}>
            {pending === 'delete' ? 'Удаляем…' : 'Удалить фото'}
          </button>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {feedback && <p className={s.hint} role="status">{feedback}</p>}
      </div>
    </form>
  </section>;
}

export function ProfileSettings({ account, onAvatarChange }: ProfileSettingsProps) {
  const [pairing, setPairing] = useState<PairingCode>();
  const [visible, setVisible] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const { data, error: loadError, reload } = useCabinetResource<TelegramStatus>(
    '/telegram', pairing ? 4000 : 12000,
  );

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setTimeout(() => {
      setPairing(undefined);
      setVisible(false);
      setExpired(true);
      setFeedback('');
    }, Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pairing]);

  useEffect(() => {
    if (data?.connected) {
      setPairing(undefined);
      setVisible(false);
      setExpired(false);
      setFeedback('');
    }
  }, [data?.connected]);

  async function showCode(renew = false) {
    setError('');
    setFeedback('');
    if (!renew && visible) {
      setVisible(false);
      return;
    }
    if (!renew && pairing && Date.parse(pairing.expiresAt) > Date.now()) {
      setVisible(true);
      return;
    }
    setBusy(true);
    try {
      setPairing(await api<PairingCode>('/telegram/code', { method: 'POST' }));
      setExpired(false);
      setVisible(true);
      if (renew) setFeedback('Код обновлён. Предыдущий код недействителен.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось получить код.');
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!pairing || Date.parse(pairing.expiresAt) <= Date.now()) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setFeedback('Код скопирован.');
    } catch {
      setFeedback('Выделите код и скопируйте вручную.');
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api<TelegramStatus>('/telegram', { method: 'DELETE' });
      setFeedback('Telegram отключён.');
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось отключить Telegram.');
    } finally {
      setBusy(false);
    }
  }

  const botUsername = data?.botUsername;
  const botUrl = botUsername && /^[a-z\d_]{5,32}$/i.test(botUsername) ? `https://t.me/${botUsername}` : undefined;

  return <>
    <h1 className={s.heading}>Настройки профиля</h1>
    <ProfilePhoto key={account.id} account={account} onAvatarChange={onAvatarChange} />
    <section className={`panel ${cabinet.section} ${s.panel}`} aria-labelledby="telegram-title">
      <div className={s.header}>
        <h2 id="telegram-title">Уведомления в Telegram</h2>
        {data?.configured && <span className={s.status} data-connected={data.connected}>
          {data.connected ? 'Подключено' : 'Не подключено'}
        </span>}
      </div>
      <p className="muted">Бот напомнит о сроках сдачи и сообщит о событиях в вашем кабинете.</p>
      {!data && !loadError && <p className="muted" role="status">Проверяем подключение…</p>}
      {loadError && <div className={s.actions}>
        <p className="error" role="alert">{loadError}</p>
        <button className="button outline" type="button" onClick={reload}>Проверить ещё раз</button>
      </div>}
      {data && !data.configured && <p className={s.hint}>Подключение бота сейчас недоступно.</p>}
      {data?.configured && !data.connected && <>
        <p className={s.hint}>Покажите личный код и отправьте его боту в личном чате. Код действует 10 минут.</p>
        <div className={s.codeRow}>
          <span className={s.codeLabel}>Личный код</span>
          <code className={s.code} aria-label={visible ? undefined : 'Код скрыт'}>
            {visible && pairing ? pairing.code : '••••••••'}
          </code>
        </div>
        {expired && <p className={s.hint} role="status">Срок действия кода истёк. Покажите новый код.</p>}
        {visible && pairing && <p className={s.hint}>Действует до <time dateTime={pairing.expiresAt}>
          {codeTime.format(new Date(pairing.expiresAt))} МСК
        </time>.</p>}
        <div className={s.actions}>
          <button type="button" className={`button ${visible ? 'outline' : 'primary'}`} onClick={() => showCode()} disabled={busy}>
            {busy && !pairing ? 'Получаем код…' : visible ? 'Скрыть код' : 'Показать код'}
          </button>
          {visible && pairing && <button type="button" className="button outline" onClick={copyCode} disabled={busy}>
            Скопировать код
          </button>}
          {pairing && <button type="button" className="button outline" onClick={() => showCode(true)} disabled={busy}>
            {busy ? 'Обновляем код…' : 'Обновить код'}
          </button>}
          {botUrl && <a className="button outline" href={botUrl} target="_blank" rel="noopener noreferrer">
            Открыть бота <span aria-hidden="true">↗</span>
          </a>}
        </div>
      </>}
      {data?.configured && data.connected && <div className={s.actions}>
        <button type="button" className="button outline" onClick={disconnect} disabled={busy}>
          {busy ? 'Отключаем…' : 'Отключить Telegram'}
        </button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {feedback && <p className={s.hint} role="status">{feedback}</p>}
    </section>
  </>;
}
