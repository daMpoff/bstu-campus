import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, apiResponse, type Attachment } from './api';
import s from './assignments.module.css';

type Preview =
  | { kind: 'loading' | 'unavailable' }
  | { kind: 'text' | 'image' | 'pdf' | 'error'; content: string };

function AttachmentDialog({ fileName, previewPath, downloadPath, onClose }: {
  fileName: string; previewPath: string; downloadPath: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fileId = useId();
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

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
          || (mime === 'application/pdf' && navigator.pdfViewerEnabled)) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: mime === 'application/pdf' ? 'pdf' : 'image', content: objectUrl });
        } else if (!controller.signal.aborted) {
          setPreview({ kind: 'unavailable' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview(error instanceof ApiError && error.status === 415
          ? { kind: 'unavailable' }
          : { kind: 'error', content: 'Не удалось открыть вложение. Закройте окно и попробуйте ещё раз.' });
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewPath]);

  return <dialog ref={dialog} className={s.previewDialog} aria-labelledby={titleId} aria-describedby={fileId} onClose={onClose}>
    <header className={s.previewHeader}>
      <div><h2 id={titleId}>Предпросмотр вложения</h2><p id={fileId}>{fileName}</p></div>
      <button type="button" className="button outline" onClick={() => dialog.current?.close()}>Закрыть</button>
    </header>
    <div className={s.previewBody}>
      {preview.kind === 'loading' && <p className="muted" role="status">Загружаем вложение…</p>}
      {preview.kind === 'text' && <pre className={s.previewText}>{preview.content}</pre>}
      {preview.kind === 'image' && <img className={s.previewImage} src={preview.content} alt={fileName}
        onError={() => setPreview({ kind: 'unavailable' })} />}
      {preview.kind === 'pdf' && <iframe className={s.previewPdf} src={preview.content + '#toolbar=0'} title={fileName} />}
      {preview.kind === 'unavailable' && <div className={s.previewMessage}>
        <p>Предпросмотр этого файла недоступен.</p>
        <a className="button outline" href={downloadPath}>Скачать {fileName}</a>
      </div>}
      {preview.kind === 'error' && <p className="error" role="alert">{preview.content}</p>}
    </div>
  </dialog>;
}

export function Attachments({ work, assignmentId, studentId, ownWork = false }: {
  work: Attachment; assignmentId: number; studentId: number; ownWork?: boolean;
}) {
  const { fileName, link, previewAvailable } = work;
  if (!fileName && !link) return null;
  const downloadPath = `/api/works/${assignmentId}/files/${studentId}`;
  const previewPath = ownWork ? `/student/assignments/${assignmentId}/preview`
    : `/teacher/assignments/${assignmentId}/works/${studentId}/preview`;
  return <div className={s.attachments}>
    {link && <a href={link} target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>}
    {fileName && <FileAttachment fileName={fileName} previewAvailable={Boolean(previewAvailable)}
      previewPath={previewPath} downloadPath={downloadPath} />}
  </div>;
}

export function FileAttachment({ fileName, previewAvailable, previewPath, downloadPath }: {
  fileName: string; previewAvailable: boolean; previewPath: string; downloadPath: string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  if (!previewAvailable) return <a className="button outline" href={downloadPath}>Скачать {fileName}</a>;
  return <>
    <button type="button" className="button outline" aria-haspopup="dialog" onClick={() => setShowPreview(true)}>
      Предпросмотр {fileName}
    </button>
    {showPreview && <AttachmentDialog key={fileName} fileName={fileName} previewPath={previewPath}
      downloadPath={downloadPath} onClose={() => setShowPreview(false)} />}
  </>;
}
