import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import s from './inline-pdf.module.css';

type LoadedPdf = { file: Blob; document: PDFDocumentProxy; annotationMode: number };
type PageRender = { pdf: LoadedPdf; page: number; width: number };

const maxCanvasSide = 4096;
const maxCanvasPixels = 8 * 1024 * 1024;

export function InlinePdf({ file, fileName, onUnavailable }: {
  file: Blob; fileName: string; onUnavailable: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const unavailable = useEffectEvent(onUnavailable);
  const [loaded, setLoaded] = useState<LoadedPdf>();
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendered, setRendered] = useState<PageRender>();
  const pdf = loaded?.file === file ? loaded : undefined;
  const ready = rendered?.pdf === pdf && rendered?.page === page && rendered?.width === width;

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let task: PDFDocumentLoadingTask | undefined;

    async function load() {
      try {
        const [pdfjs, bytes] = await Promise.all([import('pdfjs-dist'), file.arrayBuffer()]);
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          enableXfa: false,
          useWorkerFetch: false,
          useWasm: false,
          stopAtErrors: true,
          canvasMaxAreaInBytes: maxCanvasPixels * 4,
        });
        const document = await task.promise;
        if (disposed) return;
        setPage(1);
        setLoaded({ file, document, annotationMode: pdfjs.AnnotationMode.DISABLE });
      } catch {
        if (!disposed) unavailable();
      }
    }

    void load();
    return () => {
      disposed = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [file]);

  useEffect(() => {
    if (!pdf || !width || !canvas.current) return;
    const target = canvas.current;
    let disposed = false;
    let source: PDFPageProxy | undefined;
    let task: RenderTask | undefined;

    async function render(selected: LoadedPdf) {
      try {
        source = await selected.document.getPage(page);
        if (disposed) return;
        const natural = source.getViewport({ scale: 1 });
        if (!(natural.width > 0 && natural.height > 0)) throw new Error('Invalid PDF page dimensions');
        const scale = Math.min(width / natural.width, maxCanvasSide / natural.height);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid PDF page dimensions');
        const viewport = source.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2,
          maxCanvasSide / Math.max(viewport.width, viewport.height),
          Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height)));
        target.width = Math.max(1, Math.floor(viewport.width * ratio));
        target.height = Math.max(1, Math.floor(viewport.height * ratio));
        target.style.inlineSize = `${viewport.width}px`;
        task = source.render({
          canvas: target, viewport, annotationMode: selected.annotationMode,
          transform: [target.width / viewport.width, 0, 0, target.height / viewport.height, 0, 0],
        });
        await task.promise;
        if (!disposed) setRendered({ pdf: selected, page, width });
      } catch {
        if (!disposed) unavailable();
      }
    }

    void render(pdf);
    return () => {
      disposed = true;
      task?.cancel();
      source?.cleanup();
    };
  }, [pdf, page, width]);

  function changePage(next: number) {
    setPage(next);
    stage.current?.scrollTo({ top: 0, left: 0 });
  }

  const total = pdf?.document.numPages ?? 0;
  return <div className={s.viewer}>
    <div className={s.stage} ref={stage} role="region" tabIndex={0} aria-label={`Документ ${fileName}`} aria-busy={!ready}>
      {!ready && <p className={`muted ${s.loading}`} role="status">Загружаем страницу PDF…</p>}
      <canvas className={s.canvas} ref={canvas} role="img" hidden={!ready}
        aria-label={`${fileName} · страница ${page} из ${total}`} />
    </div>
    {total > 1 && <nav className={s.pages} aria-label="Страницы PDF">
      <button className="button outline" type="button" disabled={page === 1}
        aria-label="Предыдущая страница" onClick={() => changePage(page - 1)}>←</button>
      <span className="muted" aria-live="polite">{page} из {total}</span>
      <button className="button outline" type="button" disabled={page === total}
        aria-label="Следующая страница" onClick={() => changePage(page + 1)}>→</button>
    </nav>}
  </div>;
}
