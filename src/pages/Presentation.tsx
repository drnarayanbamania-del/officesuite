import clsx from 'clsx';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Loader2,
  Maximize2,
  Plus,
  Presentation as PresentationIcon,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getFile } from '../lib/db';
import { downloadBytes, stripExt, uid } from '../lib/files';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';
import { pptxFromDeck } from '../tools/build';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface Slide {
  id: string;
  title: string;
  bullets: string;
  notes: string;
  image?: string;
  bg: string;
}

interface Deck {
  title: string;
  subtitle: string;
  slides: Slide[];
}

function makeSlide(title = 'New slide', bullets = ''): Slide {
  return { id: uid('slide'), title, bullets, notes: '', bg: '#ffffff' };
}

function defaultDeck(): Deck {
  return {
    title: 'Untitled presentation',
    subtitle: 'Created with Office Suite',
    slides: [
      makeSlide('A new idea', 'Start with the problem\nShow the evidence\nExplain what changes'),
      makeSlide('Section two', 'Add supporting points here'),
    ],
  };
}

export default function Presentation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const saveFile = useFiles((s) => s.save);
  const refresh = useFiles((s) => s.refresh);
  const allFiles = useFiles((s) => s.files);

  const [deck, setDeck] = useState<Deck>(defaultDeck);
  const [active, setActive] = useState(0);
  const [fileId, setFileId] = useState<string | undefined>(id);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [present, setPresent] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [notice, setNotice] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!id || loadedRef.current === id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const file = await getFile(id);
      if (cancelled) return;
      if (!file) {
        setNotice('This deck is not in the library any more.');
        setLoading(false);
        return;
      }
      const snapshot = file.meta?.deck as Deck | undefined;
      if (snapshot && Array.isArray(snapshot.slides)) {
        setDeck({
          title: snapshot.title ?? stripExt(file.name),
          subtitle: snapshot.subtitle ?? '',
          slides: snapshot.slides.map((slide) => ({
            id: slide.id ?? uid('slide'),
            title: slide.title ?? '',
            bullets: slide.bullets ?? '',
            notes: slide.notes ?? '',
            image: slide.image,
            bg: slide.bg ?? '#ffffff',
          })),
        });
        setNotice(null);
      } else {
        setDeck({ ...defaultDeck(), title: stripExt(file.name), slides: [makeSlide('Imported deck', '')] });
        setNotice(
          'This deck was added as a PPTX file, so its slide XML cannot be edited here yet. Create slides in this workspace to keep editing, or download the original.'
        );
      }
      setFileId(file.id);
      setActive(0);
      loadedRef.current = id;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (present === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresent(null);
      if (event.key === 'ArrowRight' || event.key === ' ') {
        setPresent((value) => Math.min(deck.slides.length - 1, (value ?? 0) + 1));
      }
      if (event.key === 'ArrowLeft') setPresent((value) => Math.max(0, (value ?? 0) - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [present, deck.slides.length]);

  const slide = deck.slides[active] ?? deck.slides[0];

  const patchSlide = (patch: Partial<Slide>) => {
    setDeck((current) => ({
      ...current,
      slides: current.slides.map((item, index) => (index === active ? { ...item, ...patch } : item)),
    }));
    setDirty(true);
  };

  const buildPptx = async (): Promise<ArrayBuffer> => {
    return pptxFromDeck({
      title: deck.title,
      subtitle: deck.subtitle,
      slides: deck.slides.map((item) => ({
        title: item.title,
        bullets: item.bullets.split('\n').map((line) => line.trim()).filter(Boolean),
        notes: item.notes,
        image: item.image,
      })),
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const bytes = await buildPptx();
      const saved = await saveFile({
        id: fileId,
        name: /\.pptx$/i.test(deck.title) ? deck.title : `${deck.title.trim() || 'Untitled presentation'}.pptx`,
        kind: 'slides',
        bytes,
        mime: PPTX_MIME,
        meta: { deck },
      });
      setFileId(saved.id);
      setDirty(false);
      loadedRef.current = saved.id;
      navigate(`/slides/${saved.id}`, { replace: true });
      toast('Presentation saved');
    } catch (error: any) {
      toast(error?.message ?? 'Could not save the deck', 'error');
    } finally {
      setSaving(false);
    }
  };

  const exportPptx = async () => {
    try {
      const bytes = await buildPptx();
      downloadBytes(bytes, `${deck.title || 'presentation'}.pptx`, PPTX_MIME);
      toast('PPTX downloaded');
    } catch (error: any) {
      toast(error?.message ?? 'Could not export the deck', 'error');
    }
  };

  const addImage = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patchSlide({ image: String(reader.result) });
    reader.readAsDataURL(file);
    if (imageRef.current) imageRef.current.value = '';
  };

  const moveSlide = (delta: number) => {
    const target = active + delta;
    if (target < 0 || target >= deck.slides.length) return;
    setDeck((current) => {
      const slides = [...current.slides];
      [slides[active], slides[target]] = [slides[target], slides[active]];
      return { ...current, slides };
    });
    setActive(target);
    setDirty(true);
  };

  const addSlide = () => {
    setDeck((current) => ({ ...current, slides: [...current.slides, makeSlide(`Slide ${current.slides.length + 1}`)] }));
    setActive(deck.slides.length);
    setDirty(true);
  };

  const duplicateSlide = () => {
    const copy = { ...slide, id: uid('slide') };
    setDeck((current) => {
      const slides = [...current.slides];
      slides.splice(active + 1, 0, copy);
      return { ...current, slides };
    });
    setActive(active + 1);
    setDirty(true);
  };

  const deleteSlide = () => {
    if (deck.slides.length === 1) {
      toast('A deck needs at least one slide', 'info');
      return;
    }
    setDeck((current) => ({ ...current, slides: current.slides.filter((_, index) => index !== active) }));
    setActive(Math.max(0, active - 1));
    setDirty(true);
  };

  const thisFile = allFiles.find((file) => file.id === fileId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--editor-canvas))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2 sm:px-4">
        <Link to="/" className="icon-btn" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <PresentationIcon className="h-4 w-4" />
        </span>
        <input
          value={deck.title}
          onChange={(event) => {
            setDeck((current) => ({ ...current, title: event.target.value }));
            setDirty(true);
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-ink hover:border-line focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <span className="hidden text-[11px] text-ink-muted sm:inline">
          {dirty ? 'Unsaved changes' : thisFile ? `Saved ${new Date(thisFile.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet'}
        </span>
        <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setPresent(active)}>
          <Maximize2 className="h-3.5 w-3.5" /> Present
        </button>
        <button className="btn-ghost px-2 py-1.5 text-xs" onClick={exportPptx}>
          <Download className="h-3.5 w-3.5" /> PPTX
        </button>
        <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>

      {notice ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] leading-relaxed text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          {notice}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[170px_minmax(0,1fr)_290px]">
        <aside className="hidden min-h-0 flex-col border-r border-line bg-raised lg:flex">
          <div className="flex items-center justify-between px-2.5 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Slides</span>
            <button className="icon-btn h-6 w-6" onClick={addSlide} title="Add slide">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
            {deck.slides.map((item, index) => (
              <li key={item.id}>
                <button
                  onClick={() => setActive(index)}
                  className={clsx(
                    'w-full rounded-lg border p-1.5 text-left transition',
                    index === active
                      ? 'border-brand-500 ring-2 ring-brand-500/20'
                      : 'border-line hover:border-line-strong'
                  )}
                >
                  <div className="mb-1 flex items-center justify-between px-0.5">
                    <span className="text-[9px] font-medium text-ink-muted">{index + 1}</span>
                    <span className="max-w-[110px] truncate text-[9px] text-ink-muted">{item.title}</span>
                  </div>
                  <div className="pointer-events-none">
                    <SlideView slide={item} variant="mini" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-around border-t border-line py-1.5">
            <button className="icon-btn h-6 w-6" onClick={() => moveSlide(-1)} title="Move up">
              <ChevronLeft className="h-3.5 w-3.5 rotate-90" />
            </button>
            <button className="icon-btn h-6 w-6" onClick={duplicateSlide} title="Duplicate">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button className="icon-btn h-6 w-6" onClick={() => moveSlide(1)} title="Move down">
              <ChevronRight className="h-3.5 w-3.5 rotate-90" />
            </button>
            <button className="icon-btn h-6 w-6 hover:text-rose-600" onClick={deleteSlide} title="Delete slide">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 flex-col overflow-auto p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening presentation…
            </div>
          ) : (
            <>
              <div className="mx-auto w-full max-w-[900px] overflow-hidden rounded-lg border border-line shadow-lift">
                <SlideView slide={slide} variant="large" />
              </div>
              <div className="mx-auto mt-3 flex w-full max-w-[900px] items-center justify-between text-[11px] text-ink-muted">
                <span>
                  Slide {active + 1} of {deck.slides.length}
                </span>
                <div className="flex items-center gap-1">
                  {deck.slides.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setActive(index)}
                      className={clsx('h-1.5 w-1.5 rounded-full', index === active ? 'bg-brand-600' : 'bg-line-strong')}
                      aria-label={`Go to slide ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="mx-auto mt-4 grid w-full max-w-[900px] gap-2 sm:grid-cols-3 lg:hidden">
            <button className="btn-outline text-xs" onClick={addSlide}>
              <Plus className="h-3.5 w-3.5" /> Add slide
            </button>
            <button className="btn-outline text-xs" onClick={deleteSlide}>
              <Trash2 className="h-3.5 w-3.5" /> Delete slide
            </button>
            <button className="btn-outline text-xs" onClick={() => setPresent(active)}>
              <Maximize2 className="h-3.5 w-3.5" /> Present
            </button>
          </div>
        </div>

        <aside className="border-t border-line bg-raised p-3 lg:border-l lg:border-t-0">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Slide content</h2>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="slide-title">
                Title
              </label>
              <input
                id="slide-title"
                className="field"
                value={slide?.title ?? ''}
                onChange={(event) => patchSlide({ title: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="slide-bullets">
                Bullets — one per line
              </label>
              <textarea
                id="slide-bullets"
                className="field min-h-[140px] resize-y font-sans text-[12.5px]"
                value={slide?.bullets ?? ''}
                onChange={(event) => patchSlide({ bullets: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="slide-notes">
                Speaker notes
              </label>
              <textarea
                id="slide-notes"
                className="field min-h-[70px] resize-y text-[12px]"
                value={slide?.notes ?? ''}
                onChange={(event) => patchSlide({ notes: event.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="slide-bg">
                  Background
                </label>
                <input
                  id="slide-bg"
                  type="color"
                  className="h-9 w-full cursor-pointer rounded-lg border border-line bg-raised p-1"
                  value={slide?.bg ?? '#ffffff'}
                  onChange={(event) => patchSlide({ bg: event.target.value })}
                />
              </div>
              <div>
                <span className="label">Image</span>
                <button className="btn-outline w-full text-xs" onClick={() => imageRef.current?.click()}>
                  <ImagePlus className="h-3.5 w-3.5" /> {slide?.image ? 'Replace' : 'Add'}
                </button>
                <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(event) => addImage(event.target.files)} />
              </div>
            </div>
            {slide?.image ? (
              <button className="text-[11px] text-rose-600 hover:underline" onClick={() => patchSlide({ image: undefined })}>
                Remove image
              </button>
            ) : null}
            <p className="rounded-lg bg-sunken/60 p-2 text-[10.5px] leading-relaxed text-ink-muted">
              The preview is the slide. Export writes a real 16:9 PPTX with these titles, bullets, notes and images.
            </p>
          </div>
        </aside>
      </div>

      {present !== null && deck.slides[present] ? (
        <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950">
          <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-300">
            <span>
              {present + 1} / {deck.slides.length}
            </span>
            <button className="icon-btn text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => setPresent(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-8">
            <div className="w-full max-w-[1200px] overflow-hidden rounded-md shadow-2xl">
              <SlideView slide={deck.slides[present]} variant="large" />
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 pb-5">
            <button
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              onClick={() => setPresent(Math.max(0, present - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              onClick={() => setPresent(Math.min(deck.slides.length - 1, present + 1))}
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SlideView({ slide, variant }: { slide: Slide; variant: 'large' | 'mini' }) {
  const mini = variant === 'mini';
  const bullets = slide.bullets.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden" style={{ background: slide.bg || '#ffffff' }}>
      {slide.image ? (
        <img
          src={slide.image}
          alt=""
          className={clsx('absolute object-contain', mini ? 'right-[4%] top-[14%] h-[60%] w-[38%]' : 'right-[5%] top-[12%] h-[64%] w-[38%]')}
        />
      ) : null}
      <div
        className={clsx(
          'flex h-full flex-col',
          mini ? 'p-[5%]' : 'p-[6%]',
          slide.image && (mini ? 'w-[56%]' : 'w-[55%]')
        )}
      >
        <h3
          className={clsx(
            'font-display font-bold leading-tight text-slate-900',
            mini ? 'text-[7px]' : 'text-[clamp(16px,2.6vw,34px)]'
          )}
        >
          {slide.title || 'Untitled slide'}
        </h3>
        <ul className={clsx('mt-[4%] space-y-[2%] text-slate-700', mini ? 'text-[5px] leading-[1.3]' : 'text-[clamp(9px,1.2vw,15px)] leading-snug')}>
          {bullets.slice(0, mini ? 4 : 8).map((bullet, index) => (
            <li key={index} className="flex gap-1.5">
              <span className={clsx('shrink-0 rounded-full bg-slate-500', mini ? 'mt-[0.5em] h-[2px] w-[2px]' : 'mt-[0.55em] h-1 w-1')} />
              <span className="min-w-0">{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
      {!mini ? (
        <div className="absolute bottom-[3%] right-[3.5%] text-[10px] text-slate-400">Office Suite</div>
      ) : null}
    </div>
  );
}
