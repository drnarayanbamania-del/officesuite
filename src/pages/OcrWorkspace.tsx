import clsx from 'clsx';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileSearch,
  Info,
  Loader2,
  Play,
  Save,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { FilePicker, type PickedFile } from '../components/FilePicker';
import { Badge, Progress, Spinner } from '../components/ui';
import { getFile } from '../lib/db';
import { humanSize, kindOf } from '../lib/files';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';
import {
  detectScannedPdf,
  ocrPdf,
  type DetectResult,
  type OcrLanguage,
  type OcrOutput,
  type OcrResult,
} from '../tools/ocr';
import { openPdf, renderPages } from '../tools/pdf-utils';

const LANGUAGES: { value: OcrLanguage; label: string }[] = [
  { value: 'eng+hin', label: 'Auto — English + Hindi' },
  { value: 'eng', label: 'English' },
  { value: 'hin', label: 'Hindi (देवनागरी)' },
];

export default function OcrWorkspace() {
  const saveToLibrary = useFiles((state) => state.save);

  const [files, setFiles] = useState<PickedFile[]>([]);
  const [detection, setDetection] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [beforePreview, setBeforePreview] = useState<string>('');
  const [languages, setLanguages] = useState<OcrLanguage>('eng+hin');
  const [pages, setPages] = useState('');
  const [dpi, setDpi] = useState('200');
  const [enhance, setEnhance] = useState(true);
  const [deskew, setDeskew] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [afterTab, setAfterTab] = useState<'image' | 'text'>('image');
  const [saving, setSaving] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const [params] = useSearchParams();
  const prefillId = params.get('file');

  useEffect(() => {
    if (!prefillId) return;
    let cancelled = false;
    (async () => {
      const stored = await getFile(prefillId);
      if (cancelled || !stored) return;
      const isPdf = stored.mime === 'application/pdf' || stored.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) return;
      setFiles([{ name: stored.name, bytes: stored.bytes }]);
    })();
    return () => {
      cancelled = true;
    };
  }, [prefillId]);

  const file = files[0];
  const fileKey = file ? `${file.name}:${file.bytes.byteLength}` : '';

  useEffect(() => {
    setDetection(null);
    setBeforePreview('');
    setResult(null);
    setError(null);
    setPreviewIndex(0);
    if (!file) return;
    let cancelled = false;
    setDetecting(true);
    (async () => {
      try {
        const [detected, document] = await Promise.all([
          detectScannedPdf(file.bytes),
          openPdf(file.bytes),
        ]);
        if (cancelled) {
          document.destroy().catch(() => undefined);
          return;
        }
        setDetection(detected);
        // Do not keep the Recognize button disabled while the first-page
        // preview renders; detection has already finished at this point.
        setDetecting(false);
        const rendered = await renderPages(document, [1], 1.1);
        if (!cancelled) setBeforePreview(rendered[0].canvas.toDataURL('image/jpeg', 0.82));
        document.destroy().catch(() => undefined);
      } catch (caught: any) {
        if (!cancelled) setError(caught?.message ?? 'This PDF could not be read.');
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const recognize = async () => {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress({ value: 0.01, label: 'Preparing recognition' });
    try {
      const output = await ocrPdf(
        { name: file.name, bytes: file.bytes },
        { languages, pages, dpi: Number(dpi), enhance, deskew },
        {
          signal: controller.signal,
          onProgress: ({ ratio, label }) => setProgress({ value: ratio, label }),
        }
      );
      setResult(output);
      setPreviewIndex(0);
      setAfterTab('image');
      toast('Recognition complete');
    } catch (caught: any) {
      if (caught?.name === 'AbortError') toast('Recognition cancelled', 'info');
      else setError(caught?.message ?? 'Recognition failed.');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const saveOutput = async (output: OcrOutput) => {
    setSaving(output.name);
    try {
      const saved = await saveToLibrary({
        name: output.name,
        kind: kindOf(output.name, output.mime),
        bytes: output.bytes,
        mime: output.mime,
      });
      toast(`Saved ${saved.name} to your library`);
    } catch (caught: any) {
      toast(caught?.message ?? 'Could not save this file', 'error');
    } finally {
      setSaving('');
    }
  };

  const copyPageText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Page text copied');
    } catch {
      toast('Clipboard access was blocked by the browser', 'error');
    }
  };

  const currentPage = result?.pages[Math.min(previewIndex, (result?.pages.length ?? 1) - 1)];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/" className="mb-2 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Workspace
          </Link>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <FileSearch className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight text-ink">Recognize scanned copies</h1>
              <p className="text-sm text-ink-soft">
                Turn image-only PDFs into searchable documents with English and Hindi recognition.
              </p>
            </div>
          </div>
        </div>
        <Badge tone="green">On-device OCR</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">1. Select a PDF</h2>
            <FilePicker accept=".pdf" files={files} onChange={setFiles} />

            {detecting ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
                <Spinner /> Inspecting the text layer…
              </div>
            ) : null}

            {detection ? (
              <div className="mt-3 rounded-lg border border-line bg-sunken p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {detection.likelyScanned ? (
                    <Badge tone="amber">Image-only scan</Badge>
                  ) : (
                    <Badge tone="green">Text layer found</Badge>
                  )}
                  <span className="text-[11px] text-ink-soft">
                    {detection.totalPages} page{detection.totalPages === 1 ? '' : 's'} ·{' '}
                    {detection.characters} character{detection.characters === 1 ? '' : 's'} sampled
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                  {detection.likelyScanned
                    ? 'No usable text layer was found. Recognition will add selectable, searchable text.'
                    : 'This PDF already has selectable text. Recognition replaces it with a fresh text layer and keeps the page image as the visual background.'}
                </p>
              </div>
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">2. Recognition settings</h2>
            <div className="space-y-3.5">
              <div>
                <label className="label" htmlFor="ocr-language">
                  Document language
                </label>
                <select
                  id="ocr-language"
                  className="field"
                  value={languages}
                  onChange={(event) => setLanguages(event.target.value as OcrLanguage)}
                  disabled={running}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                  Auto runs both language models and picks the best reading for each word.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="ocr-pages">
                    Pages
                  </label>
                  <input
                    id="ocr-pages"
                    className="field"
                    value={pages}
                    placeholder="All pages"
                    onChange={(event) => setPages(event.target.value)}
                    disabled={running}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="ocr-dpi">
                    Scan resolution
                  </label>
                  <select
                    id="ocr-dpi"
                    className="field"
                    value={dpi}
                    onChange={(event) => setDpi(event.target.value)}
                    disabled={running}
                  >
                    <option value="150">150 DPI — fast</option>
                    <option value="200">200 DPI — recommended</option>
                    <option value="300">300 DPI — detailed</option>
                  </select>
                </div>
              </div>
              <p className="-mt-1 text-[11px] text-ink-muted">Ranges: 1-3, 5, 8- · leave blank for every page.</p>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
                  checked={enhance}
                  onChange={(event) => setEnhance(event.target.checked)}
                  disabled={running}
                />
                <span>
                  <span className="block text-[13px] font-medium text-ink">Improve scan quality</span>
                  <span className="block text-[11px] text-ink-muted">
                    Grayscale, contrast stretch and speckle removal before recognition.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
                  checked={deskew}
                  onChange={(event) => setDeskew(event.target.checked)}
                  disabled={running}
                />
                <span>
                  <span className="block text-[13px] font-medium text-ink">Deskew tilted pages</span>
                  <span className="block text-[11px] text-ink-muted">
                    Detects small rotations and levels the page before recognition.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                className="btn-primary flex-1"
                onClick={recognize}
                disabled={!file || running || detecting}
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {running ? 'Recognizing…' : 'Recognize'}
              </button>
              {running ? (
                <button className="btn-ghost" onClick={() => abortRef.current?.abort()}>
                  <X className="h-4 w-4" /> Cancel
                </button>
              ) : files.length ? (
                <button className="btn-ghost" onClick={() => setFiles([])} title="Remove file">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {running ? (
              <div className="mt-4">
                <Progress value={progress.value} label={progress.label} />
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Info className="h-4 w-4 text-ink-muted" /> How it works
            </h2>
            <ul className="space-y-2 text-[11px] leading-relaxed text-ink-soft">
              <li>Pages are rendered at the chosen resolution and processed one at a time, so large PDFs do not load into memory at once.</li>
              <li>The searchable PDF keeps the scanned page as its visual background and adds an invisible text layer aligned to every recognized word.</li>
              <li>Hindi text uses the bundled Noto Sans Devanagari font; English uses Noto Sans.</li>
              <li>The Tesseract engine and both language models are bundled with the app and run locally. Nothing is uploaded.</li>
            </ul>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">3. Before and after</h2>
              {currentPage && result ? (
                <div className="inline-flex rounded-lg border border-line p-0.5">
                  <button
                    className={clsx(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                      afterTab === 'image' ? 'bg-brand-600 text-white' : 'text-ink-soft hover:text-ink'
                    )}
                    onClick={() => setAfterTab('image')}
                  >
                    Page image
                  </button>
                  <button
                    className={clsx(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                      afterTab === 'text' ? 'bg-brand-600 text-white' : 'text-ink-soft hover:text-ink'
                    )}
                    onClick={() => setAfterTab('text')}
                  >
                    Recognized text
                  </button>
                </div>
              ) : null}
            </div>

            {!file ? (
              <div className="rounded-xl border border-dashed border-line-strong bg-sunken p-10 text-center">
                <FileSearch className="mx-auto h-8 w-8 text-ink-muted" />
                <p className="mt-3 text-sm font-medium text-ink">Select a scanned PDF to begin</p>
                <p className="mt-1 text-xs text-ink-soft">
                  You will see the original page beside the recognized page and its text layer.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-ink-soft">
                    <span>Before — original page</span>
                    {detection?.likelyScanned ? <span className="text-amber-600 dark:text-amber-400">no text layer</span> : null}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-line bg-sunken">
                    {beforePreview ? (
                      <img src={beforePreview} alt="Original first page" className="w-full" />
                    ) : (
                      <div className="flex h-64 items-center justify-center text-xs text-ink-muted">
                        <Spinner className="mr-2" /> Rendering page…
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-ink-soft">
                    <span>After — recognized page</span>
                    {currentPage ? <span className="text-emerald-600 dark:text-emerald-400">{currentPage.confidence}% confidence</span> : null}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-line bg-sunken">
                    {currentPage && afterTab === 'image' ? (
                      <div className="relative">
                        <img src={currentPage.preview} alt={`Recognized page ${currentPage.pageNumber}`} className="w-full" />
                        {currentPage.words.map((word, index) => (
                          <span
                            key={`${currentPage.pageNumber}-${index}`}
                            title={`${word.text} · ${Math.round(word.confidence)}%`}
                            className="absolute border border-brand-500/60 bg-brand-500/15"
                            style={{
                              left: `${word.x * 100}%`,
                              top: `${word.y * 100}%`,
                              width: `${word.w * 100}%`,
                              height: `${word.h * 100}%`,
                            }}
                          />
                        ))}
                      </div>
                    ) : currentPage && afterTab === 'text' ? (
                      <div className="relative">
                        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-ink">
                          {currentPage.text || 'No text was recognized on this page.'}
                        </pre>
                        <button
                          className="icon-btn absolute right-2 top-2 bg-raised/90 backdrop-blur"
                          onClick={() => copyPageText(currentPage.text)}
                          title="Copy page text"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-64 flex-col items-center justify-center gap-2 text-xs text-ink-muted">
                        <FileSearch className="h-6 w-6" />
                        {running ? 'Recognition in progress…' : 'Run recognition to see the result'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {result && result.pages.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {result.pages.map((page, index) => (
                  <button
                    key={page.pageNumber}
                    className={clsx(
                      'rounded-md border px-2 py-1 text-[11px] tabular-nums transition',
                      index === previewIndex
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'border-line text-ink-soft hover:border-line-strong'
                    )}
                    onClick={() => setPreviewIndex(index)}
                  >
                    Page {page.pageNumber}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {result ? (
            <section className="card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">4. Results</h2>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" /> {result.processedPages} of {result.totalPages} pages processed
                </span>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-2">
                <Stat label="Confidence" value={`${result.averageConfidence}%`} />
                <Stat label="Pages" value={String(result.processedPages)} />
                <Stat label="Time" value={`${(result.elapsedMs / 1000).toFixed(1)}s`} />
              </div>

              <div className="divide-y divide-line rounded-lg border border-line">
                {result.outputs.map((output) => (
                  <div key={output.name} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{output.label}</p>
                      <p className="truncate text-[11px] text-ink-muted">
                        {output.name} · {humanSize(output.bytes.byteLength)}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        className="btn-outline px-2.5 py-1 text-[11px]"
                        onClick={() => {
                          const blob = new Blob([output.bytes], { type: output.mime });
                          const url = URL.createObjectURL(blob);
                          const anchor = document.createElement('a');
                          anchor.href = url;
                          anchor.download = output.name;
                          anchor.click();
                          setTimeout(() => URL.revokeObjectURL(url), 4000);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                      <button
                        className="btn-ghost px-2.5 py-1 text-[11px]"
                        onClick={() => saveOutput(output)}
                        disabled={saving === output.name}
                      >
                        {saving === output.name ? <Spinner /> : <Save className="h-3.5 w-3.5" />} Save
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {result.notes.length ? (
                <ul className="mt-4 space-y-1.5">
                  {result.notes.map((note) => (
                    <li key={note} className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-soft">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                      {note}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-sunken px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
