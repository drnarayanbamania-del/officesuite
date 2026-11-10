import clsx from 'clsx';
import { Download, Loader2, RotateCcw, RotateCw, Trash2, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { canvasToBytes, openPdf } from '../tools/pdf-utils';
import { downloadBytes, humanSize } from '../lib/files';
import { toast } from '../lib/ui';
import type { PickedFile } from './FilePicker';

interface PageItem {
  source: number;
  rotation: number;
  thumb: string;
}

export default function PageOrganizer({ file }: { file: PickedFile }) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    (async () => {
      const doc = await openPdf(file.bytes);
      const items: PageItem[] = [];
      const total = doc.numPages;
      for (let i = 1; i <= total; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 0.32 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, canvas } as any).promise;
        items.push({ source: i, rotation: 0, thumb: canvas.toDataURL('image/jpeg', 0.7) });
        page.cleanup();
        if (i % 4 === 0 || i === total) {
          if (!cancelled) setPages([...items]);
        }
      }
      doc.destroy().catch(() => undefined);
      if (!cancelled) setLoading(false);
    })().catch((err) => {
      if (!cancelled) {
        setError(err?.message ?? 'Could not render this PDF.');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const move = (index: number, delta: number) => {
    const next = [...pages];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPages(next);
    setSelected(target);
  };

  const rotate = (index: number, delta: number) => {
    setPages((current) =>
      current.map((page, i) => (i === index ? { ...page, rotation: (page.rotation + delta + 360) % 360 } : page))
    );
  };

  const remove = (index: number) => {
    setPages((current) => current.filter((_, i) => i !== index));
    setSelected(null);
  };

  const save = async () => {
    if (!pages.length) return;
    setSaving(true);
    try {
      const source = await PDFDocument.load(file.bytes.slice(0), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      for (const page of pages) {
        const [copied] = await out.copyPages(source, [page.source - 1]);
        const base = copied.getRotation().angle ?? 0;
        copied.setRotation(degrees((base + page.rotation) % 360));
        out.addPage(copied);
      }
      out.setProducer('Office Suite');
      const bytes = new Uint8Array(await out.save());
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      downloadBytes(copy.buffer, file.name.replace(/\.pdf$/i, '') + '-organized.pdf', 'application/pdf');
      toast(`Saved ${pages.length} page${pages.length === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast(err?.message ?? 'Could not save the reorganized PDF', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>;
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Pages</h2>
          <p className="text-[11px] text-ink-muted">
            {loading ? 'Rendering previews…' : `${pages.length} page${pages.length === 1 ? '' : 's'} · click to select`}
          </p>
        </div>
        <button className="btn-primary px-3 py-1.5 text-xs" onClick={save} disabled={!pages.length || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {saving ? 'Saving…' : 'Save PDF'}
        </button>
      </div>

      {loading && !pages.length ? (
        <div className="flex items-center gap-2 py-6 text-xs text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Rendering page thumbnails…
        </div>
      ) : null}

      <ul className="grid max-h-[520px] grid-cols-2 gap-2 overflow-y-auto pr-1">
        {pages.map((page, index) => (
          <li
            key={`${page.source}-${index}`}
            onClick={() => setSelected(index)}
            className={clsx(
              'group relative cursor-pointer overflow-hidden rounded-lg border bg-white p-1.5 transition',
              selected === index ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line hover:border-line-strong'
            )}
          >
            <div className="flex h-[112px] items-center justify-center overflow-hidden rounded bg-slate-50">
              <img
                src={page.thumb}
                alt={`Page ${page.source}`}
                className="max-h-full max-w-full object-contain transition"
                style={{ transform: `rotate(${page.rotation}deg)` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between px-0.5">
              <span className="text-[10px] font-medium text-slate-600">
                {index + 1}
                <span className="ml-1 text-slate-400">(src {page.source})</span>
              </span>
              <div className="flex opacity-100">
                <button
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    move(index, -1);
                  }}
                  title="Move earlier"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    move(index, 1);
                  }}
                  title="Move later"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
                <button
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    rotate(index, -90);
                  }}
                  title="Rotate left"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    rotate(index, 90);
                  }}
                  title="Rotate right"
                >
                  <RotateCw className="h-3 w-3" />
                </button>
                <button
                  className="rounded p-0.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(index);
                  }}
                  title="Delete page"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selected !== null && pages[selected] ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-sunken/60 px-2.5 py-2 text-[11px] text-ink-soft">
          <span>
            Page {selected + 1} · source page {pages[selected].source} · rotation {pages[selected].rotation}°
          </span>
          <button className="inline-flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-3 w-3" /> Clear
          </button>
        </div>
      ) : null}

      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-muted">
        The reorganized PDF is {humanSize(file.bytes.byteLength)} before edits. Page content is copied, never re-rendered.
      </p>
    </section>
  );
}
