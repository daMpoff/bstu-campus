import { useEffect, useState } from 'react';
import { api } from './api';
import { useCabinetResource } from './useCabinetResource';
import cabinet from './cabinet.module.css';
import s from './settings.module.css';

type TelegramStatus = { configured: boolean; botUsername: string | null; connected: boolean };
type PairingCode = { code: string; expiresAt: string };

const codeTime = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
});

export function ProfileSettings() {
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
