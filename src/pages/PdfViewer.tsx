import clsx from 'clsx';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  Save,
  ScanText,
  Stamp,
  Trash2,
  Type,
  Upload,
  ZoomIn,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getFile, type StoredFile } from '../lib/db';
import { downloadBytes, humanSize, latinOnly, stripExt, uid } from '../lib/files';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';
import { openPdf, type PDFDoc } from '../tools/pdf-utils';
import { Badge, EmptyState, Modal, Spinner } from '../components/ui';

type Mode = 'view' | 'highlight' | 'comment' | 'stamp' | 'text' | 'image';

interface Annotation {
  id: string;
  page: number;
  type: 'highlight' | 'comment' | 'stamp' | 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  fontSize?: number;
  image?: string;
}

const COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa'];

async function imageFileToDataUrl(file: File): Promise<{ dataUrl: string; aspect: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This image could not be decoded.'));
      element.src = url;
    });
    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  const value = parseInt(normalized, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

export default function PdfViewer() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const files = useFiles((s) => s.files);
  const refresh = useFiles((s) => s.refresh);
  const saveFile = useFiles((s) => s.save);

  const file = files.find((item) => item.id === id);
  const [doc, setDoc] = useState<PDFDoc | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.15);
  const [mode, setMode] = useState<Mode>(() => {
    const requested = params.get('mode');
    return requested === 'highlight' || requested === 'comment' || requested === 'stamp' || requested === 'text' || requested === 'image'
      ? requested
      : 'view';
  });
  const [stampLabel, setStampLabel] = useState('APPROVED');
  const [color, setColor] = useState(COLORS[0]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const [textSize, setTextSize] = useState(16);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; aspect: number; name: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDoc | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!file) return;
    if (file.kind !== 'pdf') {
      setError('This library item is not a PDF.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    setThumbs([]);
    setPage(1);

    (async () => {
      const loaded = await openPdf(file.bytes);
      if (cancelled) {
        loaded.destroy().catch(() => undefined);
        return;
      }
      docRef.current = loaded;
      setDoc(loaded);
      setNumPages(loaded.numPages);
      setLoading(false);

      const images: string[] = [];
      for (let i = 1; i <= Math.min(loaded.numPages, 80); i++) {
        if (cancelled) return;
        const pdfPage = await loaded.getPage(i);
        const viewport = pdfPage.getViewport({ scale: 0.22 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: context, viewport, canvas } as any).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.62));
        pdfPage.cleanup();
        if (i % 4 === 0) setThumbs([...images]);
      }
      if (!cancelled) setThumbs([...images]);
    })().catch((err) => {
      if (!cancelled) {
        setError(err?.message ?? 'Could not open this PDF.');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      docRef.current?.destroy().catch(() => undefined);
      docRef.current = null;
    };
  }, [file?.id]);

  useEffect(() => {
    if (!file) return;
    const stored = file.meta?.annotations;
    setAnnotations(Array.isArray(stored) ? (stored as Annotation[]) : []);
  }, [file?.id]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const render = async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: 1.35 * zoom });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d', { alpha: false })!;
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: context, viewport, canvas } as any);
      renderTaskRef.current = task as unknown as { cancel: () => void };
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      try {
        await task.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') console.warn(err);
      } finally {
        pdfPage.cleanup();
      }
    };
    render().catch((err) => {
      if (!cancelled) console.warn('Page render failed', err);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, zoom]);

  const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === page), [annotations, page]);

  const persist = async (next: Annotation[]) => {
    setAnnotations(next);
    if (!file) return;
    await saveFile({
      id: file.id,
      name: file.name,
      kind: file.kind,
      bytes: file.bytes,
      mime: file.mime,
      meta: { ...(file.meta ?? {}), annotations: next },
    });
  };

  const addAnnotation = (annotation: Omit<Annotation, 'id'>) => {
    persist([...annotations, { ...annotation, id: uid('ann') }]).catch(() => toast('Could not save the annotation', 'error'));
  };

  const removeAnnotation = (annotationId: string) => {
    persist(annotations.filter((a) => a.id !== annotationId)).catch(() => undefined);
  };

  const pointOf = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'highlight') return;
    event.preventDefault();
    const point = pointOf(event);
    dragStartRef.current = point;
    setDrag({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || mode !== 'highlight') return;
    const point = pointOf(event);
    setDrag({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    });
  };

  const finishDrag = () => {
    if (drag && drag.w > 0.008 && drag.h > 0.004) {
      addAnnotation({ page, type: 'highlight', ...drag, text: 'Highlight', color });
    }
    dragStartRef.current = null;
    setDrag(null);
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = pointOf(event);
    if (mode === 'comment') {
      setCommentDraft(point);
      setCommentText('');
    } else if (mode === 'stamp') {
      addAnnotation({ page, type: 'stamp', x: point.x, y: point.y, w: 0.24, h: 0.075, text: stampLabel, color });
    } else if (mode === 'text') {
      setTextDraft(point);
      setTextValue('');
    } else if (mode === 'image') {
      if (!pendingImage) {
        imageInputRef.current?.click();
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const w = 0.32;
      const h = Math.min(0.7, Math.max(0.08, (w * rect.width) / rect.height / pendingImage.aspect));
      addAnnotation({
        page,
        type: 'image',
        x: Math.max(0, Math.min(1 - w, point.x - w / 2)),
        y: Math.max(0, Math.min(1 - h, point.y - h / 2)),
        w,
        h,
        text: pendingImage.name,
        color,
        image: pendingImage.dataUrl,
      });
      setPendingImage(null);
    }
  };

  const chooseImage = async (list: FileList | null) => {
    const selected = list?.[0];
    if (!selected) return;
    if (selected.size > 10 * 1024 * 1024) {
      if (imageInputRef.current) imageInputRef.current.value = '';
      toast('Choose an image smaller than 10 MB', 'info');
      return;
    }
    try {
      const picked = await imageFileToDataUrl(selected);
      setPendingImage({ ...picked, name: selected.name });
      setMode('image');
      toast('Image ready — click the page to place it', 'info');
    } catch (err: any) {
      toast(err?.message ?? 'Could not read that image', 'error');
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const addTextAnnotation = () => {
    if (!textDraft) return;
    const text = textValue.trim();
    if (!text) {
      toast('Type some text first', 'info');
      return;
    }
    addAnnotation({
      page,
      type: 'text',
      x: Math.min(0.55, Math.max(0, textDraft.x)),
      y: Math.min(0.92, Math.max(0, textDraft.y)),
      w: 0.45,
      h: 0.08,
      text,
      color,
      fontSize: textSize,
    });
    setTextDraft(null);
    setTextValue('');
  };

  const exportAnnotated = async () => {
    if (!file) return;
    setExporting(true);
    try {
      const pdf = await PDFDocument.load(file.bytes.slice(0), { ignoreEncryption: true });
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      for (const annotation of annotations) {
        const target = pdf.getPage(annotation.page - 1);
        if (!target) continue;
        const { width, height } = target.getSize();
        const w = annotation.w * width;
        const h = annotation.h * height;
        const x = annotation.x * width;
        const y = Math.max(4, height - (annotation.y + annotation.h) * height);
        const shade = hexToRgb(annotation.color);
        if (annotation.type === 'highlight') {
          target.drawRectangle({ x, y, width: w, height: h, color: shade, opacity: 0.34 });
        } else if (annotation.type === 'stamp') {
          target.drawRectangle({ x, y, width: w, height: h, borderColor: shade, borderWidth: 1.6 });
          target.drawText(annotation.text.toUpperCase().slice(0, 18), {
            x: x + 6,
            y: y + h / 2 - 5,
            size: Math.max(7, Math.min(18, h * 0.5)),
            font: bold,
            color: shade,
          });
        } else if (annotation.type === 'text') {
          const size = Math.min(72, Math.max(7, annotation.fontSize ?? 16));
          const text = latinOnly(annotation.text).trim();
          if (!text) continue;
          target.drawText(text, {
            x,
            y: Math.max(4, height - annotation.y * height - size),
            size,
            font,
            color: shade,
            maxWidth: Math.max(24, w),
            lineHeight: size * 1.2,
          });
        } else if (annotation.type === 'image') {
          if (!annotation.image) continue;
          const encoded = annotation.image.split(',')[1];
          if (!encoded) continue;
          const imageBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
          const embedded = await pdf.embedPng(imageBytes);
          target.drawImage(embedded, { x, y, width: w, height: h });
        } else {
          target.drawRectangle({
            x,
            y,
            width: Math.max(w, Math.min(220, width * 0.4)),
            height: Math.max(h, 26),
            color: rgb(1, 0.98, 0.82),
            borderColor: shade,
            borderWidth: 0.8,
          });
          target.drawText(latinOnly(annotation.text).slice(0, 90) || 'Comment', {
            x: x + 4,
            y: y + Math.max(h, 26) - 13,
            size: 8,
            font,
            color: rgb(0.12, 0.16, 0.22),
            maxWidth: Math.max(w, Math.min(220, width * 0.4)) - 8,
          });
        }
      }
      pdf.setProducer('Office Suite');
      const bytes = new Uint8Array(await pdf.save());
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      downloadBytes(copy.buffer, `${stripExt(file.name)}-annotated.pdf`, 'application/pdf');
      toast('Annotated PDF downloaded');
    } catch (err: any) {
      toast(err?.message ?? 'Could not flatten the annotations', 'error');
    } finally {
      setExporting(false);
    }
  };

  const upload = async (list: FileList | null) => {
    const selected = list?.[0];
    if (!selected) return;
    const bytes = await selected.arrayBuffer();
    const saved = await saveFile({ name: selected.name, kind: 'pdf', bytes, mime: 'application/pdf' });
    toast('PDF added');
    navigate(`/pdf/${saved.id}`);
    if (uploadRef.current) uploadRef.current.value = '';
  };

  if (!id) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">PDF workspace</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Read, highlight, comment, stamp and export. Open a PDF from your library or add a new one.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button className="btn-primary" onClick={() => uploadRef.current?.click()}>
            <Upload className="h-4 w-4" /> Add a PDF
          </button>
          <Link className="btn-outline" to="/tools/annotate-pdf">
            <Highlighter className="h-4 w-4" /> Annotation tools
          </Link>
          <Link className="btn-outline" to="/tools/recognize-scanned-copies">
            <ScanText className="h-4 w-4" /> OCR scans
          </Link>
        </div>
        <input ref={uploadRef} type="file" accept=".pdf" className="hidden" onChange={(event) => upload(event.target.files)} />
        <div className="mt-6">
          {files.filter((item) => item.kind === 'pdf').length ? (
            <ul className="space-y-1.5">
              {files
                .filter((item) => item.kind === 'pdf')
                .map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => navigate(`/pdf/${item.id}`)}
                      className="flex w-full items-center justify-between rounded-lg border border-line bg-raised px-3 py-2.5 text-left hover:border-brand-400"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{item.name}</span>
                        <span className="text-[11px] text-ink-muted">{humanSize(item.size)}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-ink-muted" />
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <EmptyState icon={Highlighter} title="No PDFs in the library yet" description="Add one above to start annotating." />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--editor-canvas))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2 sm:px-4">
        <Link to="/" className="icon-btn" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{file?.name ?? 'PDF'}</p>
          <p className="text-[10.5px] text-ink-muted">
            {numPages ? `${numPages} page${numPages === 1 ? '' : 's'}` : 'Loading…'}
            {file ? ` · ${humanSize(file.size)}` : ''}
            {annotations.length ? ` · ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <Badge tone="green">
          <Save className="h-3 w-3" /> Auto-saved
        </Badge>
        <Link
          className="btn-outline px-2.5 py-1.5 text-xs"
          to={`/tools/recognize-scanned-copies?file=${encodeURIComponent(id ?? '')}`}
          title="Recognize text in this scanned PDF"
        >
          <ScanText className="h-3.5 w-3.5" /> OCR
        </Link>
        <button className="btn-outline px-2.5 py-1.5 text-xs" onClick={exportAnnotated} disabled={exporting || !annotations.length}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export annotated PDF
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-raised px-2 py-1.5 sm:px-3">
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1 text-[11px] text-ink-soft">
            <input
              type="number"
              className="w-11 rounded border border-line bg-raised px-1 py-0.5 text-center tabular-nums"
              value={page}
              min={1}
              max={numPages || 1}
              onChange={(event) => setPage(Math.min(numPages || 1, Math.max(1, Number(event.target.value) || 1)))}
              aria-label="Page number"
            />
            <span>/ {numPages || '—'}</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setPage((p) => Math.min(numPages || 1, p + 1))}
            disabled={page >= numPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <span className="mx-1 h-5 w-px bg-line" />

        <div className="flex items-center gap-0.5">
          <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))} aria-label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-ink-soft">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.15))} aria-label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button className="icon-btn" onClick={() => setZoom(1.15)} title="Reset zoom">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        <span className="mx-1 h-5 w-px bg-line" />

        <div className="flex items-center gap-0.5 rounded-lg bg-sunken/60 p-0.5">
          {(
            [
              { id: 'view' as Mode, label: 'View', icon: ChevronRight },
              { id: 'highlight' as Mode, label: 'Highlight', icon: Highlighter },
              { id: 'comment' as Mode, label: 'Comment', icon: MessageSquare },
              { id: 'stamp' as Mode, label: 'Stamp', icon: Stamp },
              { id: 'text' as Mode, label: 'Text', icon: Type },
              { id: 'image' as Mode, label: 'Image', icon: ImageIcon },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setMode(item.id);
                if (item.id === 'image' && !pendingImage) imageInputRef.current?.click();
              }}
              className={clsx(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                mode === item.id ? 'bg-raised text-ink shadow-card' : 'text-ink-soft hover:text-ink'
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        {mode === 'stamp' ? (
          <select className="field ml-1 w-auto py-1 text-[11px]" value={stampLabel} onChange={(event) => setStampLabel(event.target.value)}>
            {['APPROVED', 'REVIEWED', 'DRAFT', 'CONFIDENTIAL', 'PAID'].map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        ) : null}

        {mode === 'text' ? (
          <select
            className="field ml-1 w-auto py-1 text-[11px]"
            value={textSize}
            onChange={(event) => setTextSize(Number(event.target.value))}
            aria-label="Text size"
          >
            {[12, 16, 20, 28, 36].map((size) => (
              <option key={size} value={size}>
                {size} pt
              </option>
            ))}
          </select>
        ) : null}

        {mode !== 'view' ? (
          <div className="flex items-center gap-1">
            {COLORS.map((swatch) => (
              <button
                key={swatch}
                onClick={() => setColor(swatch)}
                className={clsx('h-4 w-4 rounded-full border', color === swatch ? 'border-ink' : 'border-transparent')}
                style={{ background: swatch }}
                aria-label={`Use ${swatch}`}
              />
            ))}
          </div>
        ) : null}

        {mode !== 'view' ? (
          <span className="ml-auto text-[10.5px] text-ink-muted">
            {mode === 'highlight'
              ? 'Drag across a passage'
              : mode === 'comment'
                ? 'Click to drop a note'
                : mode === 'stamp'
                  ? 'Click to place the stamp'
                  : mode === 'text'
                    ? 'Click the page, then type your text'
                    : pendingImage
                      ? 'Click the page to place the image'
                      : 'Choose an image, then click the page'}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted">
            <Spinner /> Opening PDF…
          </div>
        ) : null}
        {error ? (
          <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="mx-auto w-fit">
            <div
              ref={overlayRef}
              className={clsx(
                'relative select-none bg-white shadow-lift',
                mode === 'highlight' && 'cursor-crosshair',
                mode === 'comment' && 'cursor-copy',
                mode === 'stamp' && 'cursor-cell',
                mode === 'text' && 'cursor-text',
                mode === 'image' && 'cursor-copy'
              )}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={finishDrag}
              onMouseLeave={finishDrag}
              onClick={onClick}
            >
              <canvas ref={canvasRef} className="block max-w-full" />
              {pageAnnotations.map((annotation) => (
                <div
                  key={annotation.id}
                  className="group absolute"
                  style={{
                    left: `${annotation.x * 100}%`,
                    top: `${annotation.y * 100}%`,
                    width: `${Math.max(annotation.w, 0.03) * 100}%`,
                    height: `${Math.max(annotation.h, 0.015) * 100}%`,
                  }}
                >
                  {annotation.type === 'highlight' ? (
                    <div className="h-full w-full rounded-sm" style={{ background: annotation.color, opacity: 0.38 }} />
                  ) : annotation.type === 'stamp' ? (
                    <div
                      className="flex h-full w-full items-center justify-center rounded border-2 text-[10px] font-bold uppercase tracking-wider"
                      style={{ borderColor: annotation.color, color: annotation.color, transform: 'rotate(-6deg)', background: 'rgba(255,255,255,0.55)' }}
                    >
                      {annotation.text}
                    </div>
                  ) : annotation.type === 'text' ? (
                    <div
                      className="whitespace-pre-wrap font-medium leading-tight"
                      style={{
                        color: annotation.color,
                        fontSize: `${Math.max(8, (annotation.fontSize ?? 16) * 1.35 * zoom)}px`,
                      }}
                    >
                      {annotation.text}
                    </div>
                  ) : annotation.type === 'image' ? (
                    annotation.image ? (
                      <img
                        src={annotation.image}
                        alt={annotation.text || 'Placed image'}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    ) : null
                  ) : (
                    <div className="max-w-[230px] rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10.5px] leading-snug text-amber-950 shadow-sm">
                      <span className="font-semibold">Note:</span> {annotation.text}
                    </div>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      removeAnnotation(annotation.id);
                    }}
                    className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow group-hover:grid"
                    title="Delete annotation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {drag && mode === 'highlight' ? (
                <div
                  className="pointer-events-none absolute rounded-sm"
                  style={{
                    left: `${drag.x * 100}%`,
                    top: `${drag.y * 100}%`,
                    width: `${drag.w * 100}%`,
                    height: `${drag.h * 100}%`,
                    background: color,
                    opacity: 0.3,
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {thumbs.length ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-line bg-raised px-3 py-2">
          {thumbs.map((thumb, index) => (
            <button
              key={index}
              onClick={() => setPage(index + 1)}
              className={clsx(
                'shrink-0 rounded border p-0.5 transition',
                page === index + 1 ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-line hover:border-line-strong'
              )}
              title={`Page ${index + 1}`}
            >
              <img src={thumb} alt={`Page ${index + 1}`} className="h-20 w-auto" />
              <span className="mt-0.5 block text-center text-[9px] text-ink-muted">{index + 1}</span>
            </button>
          ))}
        </div>
      ) : null}

      <input ref={uploadRef} type="file" accept=".pdf" className="hidden" onChange={(event) => upload(event.target.files)} />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => chooseImage(event.target.files)}
      />

      <Modal
        open={Boolean(commentDraft)}
        onClose={() => setCommentDraft(null)}
        title="Add a note"
        description="Notes stay with this document in your library and are flattened on export."
        footer={
          <>
            <button className="btn-ghost" onClick={() => setCommentDraft(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                if (!commentDraft) return;
                const text = commentText.trim();
                if (!text) {
                  toast('Write the note first', 'info');
                  return;
                }
                addAnnotation({ page, type: 'comment', x: commentDraft.x, y: commentDraft.y, w: 0.3, h: 0.06, text, color });
                setCommentDraft(null);
                setCommentText('');
              }}
            >
              Add note
            </button>
          </>
        }
      >
        <textarea
          className="field min-h-[100px]"
          placeholder="What should the reader notice here?"
          value={commentText}
          autoFocus
          onChange={(event) => setCommentText(event.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(textDraft)}
        onClose={() => setTextDraft(null)}
        title="Add text"
        description="Type text to place on this page. It stays editable in your library and is flattened on export."
        footer={
          <>
            <button className="btn-ghost" onClick={() => setTextDraft(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={addTextAnnotation}>
              Add text
            </button>
          </>
        }
      >
        <label className="label" htmlFor="pdf-add-text">Text</label>
        <textarea
          id="pdf-add-text"
          className="field min-h-[100px]"
          placeholder="Type the text to place on the page"
          value={textValue}
          autoFocus
          onChange={(event) => setTextValue(event.target.value)}
        />
        <div className="mt-3 flex items-center gap-2">
          <label className="label mb-0" htmlFor="pdf-text-size">Size</label>
          <select
            id="pdf-text-size"
            className="field w-auto py-1.5 text-xs"
            value={textSize}
            onChange={(event) => setTextSize(Number(event.target.value))}
          >
            {[12, 16, 20, 28, 36].map((size) => (
              <option key={size} value={size}>
                {size} pt
              </option>
            ))}
          </select>
          <span className="text-[10.5px] text-ink-muted">Current color is used</span>
        </div>
      </Modal>
    </div>
  );
}
