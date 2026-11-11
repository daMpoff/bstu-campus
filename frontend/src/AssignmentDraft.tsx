import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { useCabinetResource } from './useCabinetResource';
import s from './assignments.module.css';

export type AssignmentDraftText = { title: string; description: string };

export function AssignmentDraft({ onApply, onApplyIfEmpty, disabled = false }: {
  onApply: (draft: AssignmentDraftText) => void;
  onApplyIfEmpty?: (draft: AssignmentDraftText) => boolean;
  disabled?: boolean;
}) {
  const { data, error: statusError, reload } = useCabinetResource<{ available: boolean }>('/teacher/assignment-drafts/status');
  const request = useRef<AbortController | null>(null);
  const notesLabelId = useId();
  const hintId = useId();
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<AssignmentDraftText>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);

  useEffect(() => () => request.current?.abort(), []);

  async function generate() {
    if (disabled || request.current || !notes.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setDraft(undefined);
    setError('');
    setApplied(false);
    try {
      const result = await api<AssignmentDraftText>('/teacher/assignment-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (onApplyIfEmpty?.(result)) setApplied(true);
      else setDraft(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось подготовить черновик.');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return <details className={s.draft}>
    <summary>Черновик с ИИ</summary>
    <div className={s.draftBody}>
      {!data && !statusError && <p className="muted" role="status">Проверяем доступность генерации…</p>}
      {statusError && <>
        <p className="error" role="alert">Не удалось проверить доступность генерации.</p>
        <button type="button" className="button outline" disabled={disabled} onClick={reload}>Повторить проверку</button>
      </>}
      {data?.available === false && <p className="muted">Модель пока не подключена. Задание можно заполнить вручную.</p>}
      {data?.available && <>
        <label><span id={notesLabelId}>Тезисы задания</span>
          <textarea value={notes} maxLength={4000} rows={3} disabled={disabled || busy} aria-labelledby={notesLabelId} aria-describedby={hintId}
            placeholder="Тема, что нужно выполнить и в каком виде сдать работу"
            onChange={event => { setNotes(event.target.value); setDraft(undefined); setError(''); setApplied(false); }} />
        </label>
        <p className="muted" id={hintId}>Тезисы передаются модели. Используйте формулировки без имён и контактов.</p>
        <button type="button" className="button outline" disabled={disabled || busy || !notes.trim()} onClick={() => void generate()}>
          {busy ? 'Готовим черновик…' : 'Сгенерировать черновик'}
        </button>
        {busy && <p className="muted" role="status">Ожидаем ответ модели.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {applied && <p className="muted" role="status">Черновик перенесён в форму.</p>}
        {draft && <div className={s.draftPreview} role="region" aria-label="Черновик задания">
          <p className="muted" role="status">Черновик готов. Проверьте формулировки перед публикацией.</p>
          <strong>{draft.title}</strong>
          <p>{draft.description}</p>
          <button type="button" className="button primary" disabled={disabled} onClick={() => { onApply(draft); setDraft(undefined); }}>
            Перенести в задание
          </button>
        </div>}
      </>}
    </div>
  </details>;
}
