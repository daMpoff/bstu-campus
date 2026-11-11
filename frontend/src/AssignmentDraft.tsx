import { useState } from 'react';
import { post } from './api';
import { useCabinetResource } from './useCabinetResource';
import s from './assignments.module.css';

type Draft = { title: string; description: string };

export function AssignmentDraft({ onApply }: { onApply: (draft: Draft) => void }) {
  const { data, error: statusError, reload } = useCabinetResource<{ available: boolean }>('/teacher/assignment-drafts/status');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (busy || !notes.trim()) return;
    setBusy(true);
    setDraft(undefined);
    setError('');
    try {
      setDraft(await post<Draft>('/teacher/assignment-drafts', { notes: notes.trim() }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось подготовить черновик.');
    } finally {
      setBusy(false);
    }
  }

  return <details className={s.draft}>
    <summary>Черновик с ИИ</summary>
    <div className={s.draftBody}>
      {!data && !statusError && <p className="muted" role="status">Проверяем доступность генерации…</p>}
      {statusError && <>
        <p className="error" role="alert">Не удалось проверить доступность генерации.</p>
        <button type="button" className="button outline" onClick={reload}>Повторить проверку</button>
      </>}
      {data?.available === false && <p className="muted">Модель пока не подключена. Задание можно заполнить вручную.</p>}
      {data?.available && <>
        <label>Тезисы задания
          <textarea value={notes} maxLength={4000} rows={3} disabled={busy} aria-describedby="draft-notes-hint"
            placeholder="Тема, что нужно выполнить и в каком виде сдать работу"
            onChange={event => { setNotes(event.target.value); setDraft(undefined); setError(''); }} />
        </label>
        <p className="muted" id="draft-notes-hint">Тезисы передаются модели. Используйте формулировки без имён и контактов.</p>
        <button type="button" className="button outline" disabled={busy || !notes.trim()} onClick={() => void generate()}>
          {busy ? 'Готовим черновик…' : 'Сгенерировать черновик'}
        </button>
        {busy && <p className="muted" role="status">Ожидаем ответ модели.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {draft && <div className={s.draftPreview} role="region" aria-label="Черновик задания">
          <p className="muted" role="status">Черновик готов. Проверьте формулировки перед публикацией.</p>
          <strong>{draft.title}</strong>
          <p>{draft.description}</p>
          <button type="button" className="button primary" onClick={() => { onApply(draft); setDraft(undefined); }}>
            Перенести в задание
          </button>
        </div>}
      </>}
    </div>
  </details>;
}
