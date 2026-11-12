import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError, apiResponse, type Attachment } from './api';
import { InlinePdf } from './InlinePdf';
import s from './assignments.module.css';

type Preview =
  | { kind: 'loading' | 'unavailable' }
  | { kind: 'text' | 'image' | 'pdf'; content: string }
  | { kind: 'inline-pdf'; file: Blob }
  | { kind: 'error' };

type PreviewSource = { fileName: string; previewPath: string; downloadPath: string };

function PreviewBody({ fileName, previewPath, downloadPath, inline = false }: PreviewSource & { inline?: boolean }) {
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const unavailable = useCallback(() => setPreview({ kind: 'unavailable' }), []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await apiResponse(previewPath, { signal: controller.signal });
        const mime = response.headers.get('content-type')?.split(';', 1)[0];
        if (mime === 'text/plain') {
          const content = await response.text();
          if (!controller.signal.aborted) setPreview({ kind: 'text', content });
        } else if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].some(type => mime === type)
          || (mime === 'application/pdf' && (inline || navigator.pdfViewerEnabled))) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          if (mime === 'application/pdf' && inline) {
            setPreview({ kind: 'inline-pdf', file: blob });
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: mime === 'application/pdf' ? 'pdf' : 'image', content: objectUrl });
        } else if (!controller.signal.aborted) {
          setPreview({ kind: 'unavailable' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview(error instanceof ApiError && error.status === 415
          ? { kind: 'unavailable' }
          : { kind: 'error' });
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewPath, attempt, inline]);

  return <div className={s.previewBody}>
    {preview.kind === 'loading' && <p className="muted" role="status">Загружаем вложение…</p>}
    {preview.kind === 'text' && <pre className={s.previewText}>{preview.content}</pre>}
    {preview.kind === 'image' && <img className={s.previewImage} src={preview.content} alt={fileName} onError={unavailable} />}
    {preview.kind === 'pdf' && <iframe className={s.previewPdf} src={preview.content + '#toolbar=0'} title={fileName} />}
    {preview.kind === 'inline-pdf' && <InlinePdf file={preview.file} fileName={fileName} onUnavailable={unavailable} />}
    {preview.kind === 'unavailable' && <div className={s.previewMessage}>
      <p>Предпросмотр этого файла недоступен.</p>
      <a className="button outline" href={downloadPath}>Скачать {fileName}</a>
    </div>}
    {preview.kind === 'error' && (inline ? <div className={s.previewMessage}>
      <p className="error" role="alert">Не удалось открыть вложение.</p>
      <button className="button outline" type="button" onClick={() => {
        setPreview({ kind: 'loading' });
        setAttempt(current => current + 1);
      }}>Повторить</button>
    </div> : <p className="error" role="alert">Не удалось открыть вложение. Закройте окно и попробуйте ещё раз.</p>)}
  </div>;
}

function AttachmentDialog({ onClose, ...source }: PreviewSource & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fileId = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return <dialog ref={dialog} className={s.previewDialog} aria-labelledby={titleId} aria-describedby={fileId} onClose={onClose}>
    <header className={s.previewHeader}>
      <div><h2 id={titleId}>Предпросмотр вложения</h2><p id={fileId}>{source.fileName}</p></div>
      <button type="button" className="button outline" onClick={() => dialog.current?.close()}>Закрыть</button>
    </header>
    <PreviewBody {...source} />
  </dialog>;
}

type WorkAttachmentProps = { work: Attachment; assignmentId: number; studentId: number };

function attachmentPaths(assignmentId: number, studentId: number, ownWork = false) {
  const downloadPath = `/api/works/${assignmentId}/files/${studentId}`;
  const previewPath = ownWork ? `/student/assignments/${assignmentId}/preview`
    : `/teacher/assignments/${assignmentId}/works/${studentId}/preview`;
  return { downloadPath, previewPath };
}

function WorkLink({ link }: { link: string }) {
  return <a href={link} target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>;
}

export function Attachments({ work, assignmentId, studentId, ownWork = false }: WorkAttachmentProps & { ownWork?: boolean }) {
  const { fileName, link, previewAvailable } = work;
  if (!fileName && !link) return null;
  return <div className={s.attachments}>
    {link && <WorkLink link={link} />}
    {fileName && <FileAttachment fileName={fileName} previewAvailable={Boolean(previewAvailable)}
      {...attachmentPaths(assignmentId, studentId, ownWork)} />}
  </div>;
}

export function InlineAttachments({ work, assignmentId, studentId }: WorkAttachmentProps) {
  const { fileName, link, previewAvailable } = work;
  if (!fileName && !link) return <p className="muted">У работы нет вложений.</p>;
  if (!fileName || !previewAvailable) return <Attachments work={work} assignmentId={assignmentId} studentId={studentId} />;
  const paths = attachmentPaths(assignmentId, studentId);
  return <section className={s.inlinePreview} aria-label="Предпросмотр вложения">
    <div className={`${s.attachments} ${s.inlineToolbar}`}>
      <span className={s.inlineFileName}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6zM14 3v5h4m-9 4h6m-6 4h6" />
        </svg>
        {fileName}
      </span>
      {link && <WorkLink link={link} />}
    </div>
    <PreviewBody key={`${paths.previewPath}:${fileName}`} fileName={fileName} {...paths} inline />
  </section>;
}

export function FileAttachment({ fileName, previewAvailable, previewPath, downloadPath }: PreviewSource & { previewAvailable: boolean }) {
  const [showPreview, setShowPreview] = useState(false);
  if (!previewAvailable) return <a className="button outline" href={downloadPath}>Скачать {fileName}</a>;
  return <>
    <button type="button" className="button outline" aria-haspopup="dialog" onClick={() => setShowPreview(true)}>
      Предпросмотр {fileName}
    </button>
    {showPreview && <AttachmentDialog key={`${previewPath}:${fileName}`} fileName={fileName} previewPath={previewPath}
      downloadPath={downloadPath} onClose={() => setShowPreview(false)} />}
  </>;
}
