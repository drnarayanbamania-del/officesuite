import clsx from 'clsx';
import {
  ArrowUpRight,
  Download,
  FileText,
  Files,
  FolderOpen,
  HardDrive,
  Pencil,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Table2,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getFile, type StoredFile } from '../lib/db';
import { downloadBytes, humanDate, humanSize, kindOf, mimeOf } from '../lib/files';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';
import { CATEGORIES, TOOLS, toolsByCategory, type ToolDef } from '../tools/registry';
import { Badge, EmptyState, Modal } from '../components/ui';
import { BrandLogo } from '../components/BrandLogo';

const KIND_META = {
  writer: { icon: FileText, classes: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  sheet: { icon: Table2, classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  slides: { icon: Presentation, classes: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  pdf: { icon: FileText, classes: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  other: { icon: FolderOpen, classes: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
} as const;

function openPath(file: StoredFile): string {
  if (file.kind === 'pdf') return `/pdf/${file.id}`;
  if (file.kind === 'sheet') return `/sheet/${file.id}`;
  if (file.kind === 'slides') return `/slides/${file.id}`;
  return `/writer/${file.id}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { files, refresh, save, remove, toggleFavorite, rename } = useFiles();
  const [query, setQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState<StoredFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpload = async (list: FileList | null) => {
    if (!list || !list.length) return;
    let last: StoredFile | null = null;
    for (const file of Array.from(list)) {
      const bytes = await file.arrayBuffer();
      const kind = kindOf(file.name, file.type);
      last = await save({ name: file.name, kind, bytes, mime: file.type || mimeOf(file.name) });
    }
    if (last) {
      toast(`Added ${last.name}`);
      if (last.kind === 'pdf' || last.kind === 'sheet' || last.kind === 'slides') navigate(openPath(last));
      else if (/\.(docx?|html?|txt|md)$/i.test(last.name)) navigate(openPath(last));
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const q = query.trim().toLowerCase();
  const filteredTools = q
    ? TOOLS.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(q))
    : TOOLS;
  const filteredFiles = q ? files.filter((file) => file.name.toLowerCase().includes(q)) : files;
  const recent = filteredFiles.slice(0, 6);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const startRename = (file: StoredFile) => {
    setRenameTarget(file);
    setRenameValue(file.name);
  };

  const commitRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    await rename(renameTarget.id, name);
    setRenameTarget(null);
    toast('Renamed');
  };

  const download = async (file: StoredFile) => {
    const full = await getFile(file.id);
    if (!full) return;
    downloadBytes(full.bytes, full.name, full.mime);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <section className="relative overflow-hidden rounded-xl2 border border-line bg-raised shadow-card">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,hsl(160_70%_32%/0.06),transparent_55%)]" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:p-10 xl:grid-cols-[1.08fr_0.92fr] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone="brand">
                <Sparkles className="h-3 w-3" /> Local-first office suite
              </Badge>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                <span className="h-1 w-1 rounded-full bg-emerald-500" /> No uploads · No account
              </span>
            </div>

            <div className="relative mt-5 inline-block animate-fadeUp">
              <span
                aria-hidden="true"
                className="hero-title-aura pointer-events-none absolute -inset-x-10 -inset-y-6 z-0 rounded-[50%]"
              />
              <span aria-hidden="true" className="hero-spark hero-spark-ring" />
              <span aria-hidden="true" className="hero-spark hero-spark-dot" />
              <h1 className="relative z-10 whitespace-nowrap font-display text-[clamp(2.75rem,6.5vw,5rem)] font-bold">
                <span className="type-3d">
                  <span className="type-3d-extrude" aria-hidden="true">
                    Office Suite
                  </span>
                  <span className="type-3d-face">Office Suite</span>
                </span>
              </h1>
            </div>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-ink-muted">
              By Bamania&apos;s Tech
            </p>

            <p className="mt-4 max-w-lg text-[15px] leading-7 text-ink-soft">
              Documents, sheets, slides and PDFs in one focused workspace. {TOOLS.length} tools, zero uploads,
              and every byte stays on this device.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <button className="btn-primary h-10 px-4" onClick={() => navigate('/writer')}>
                <FileText className="h-4 w-4" /> New document
              </button>
              <button className="btn-outline h-10 px-3.5" onClick={() => navigate('/sheet')}>
                <Table2 className="h-4 w-4" /> Spreadsheet
              </button>
              <button className="btn-outline h-10 px-3.5" onClick={() => navigate('/slides')}>
                <Presentation className="h-4 w-4" /> Deck
              </button>
              <button className="btn-ghost h-10 px-3" onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Open file
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.txt,.md,.html,image/*"
                className="hidden"
                onChange={(event) => handleUpload(event.target.files)}
              />
            </div>
          </div>

          <div className="relative hidden xl:block">
            <div className="hero-visual relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-line/80 p-8">
              <span aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0 opacity-70" />
              <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-brand-500/15 blur-2xl" />
              <div className="relative w-full max-w-[300px]">
                <BrandLogo variant="full" className="justify-center" />
              </div>
              <div className="relative mt-7 inline-flex items-center gap-2 rounded-full border border-line bg-raised/80 px-3 py-1.5 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                Files stay on this device
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl2 border border-line bg-raised/80 shadow-card">
        {[
          { label: 'Files', value: String(files.length), icon: Files },
          { label: 'Stored', value: humanSize(totalBytes), icon: HardDrive },
          { label: 'Tools', value: String(TOOLS.length), icon: Wrench },
        ].map((stat, index) => (
          <div
            key={stat.label}
            className={clsx('flex items-center justify-between gap-2 px-4 py-3.5 sm:px-5', index > 0 && 'border-l border-line')}
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">{stat.label}</p>
              <p className="mt-1 truncate text-xl font-bold tracking-tight tabular-nums text-ink">{stat.value}</p>
            </div>
            <stat.icon className="hidden h-4 w-4 shrink-0 text-ink-muted sm:block" />
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Library</p>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-ink">Recent documents</h2>
        </div>
        <div className="relative w-full sm:w-[300px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            className="field pl-10"
            placeholder="Search files and tools…"
            aria-label="Search files and tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {recent.length ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {recent.map((file) => {
            const meta = KIND_META[file.kind];
            const Icon = meta.icon;
            return (
              <div
                key={file.id}
                className="group flex flex-wrap items-center gap-3 rounded-xl border border-line/90 bg-raised/80 p-3.5 transition duration-200 hover:border-line-strong hover:bg-raised hover:shadow-lift"
              >
                <button
                  onClick={() => navigate(openPath(file))}
                  className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl shadow-sm ring-1 ring-inset ring-black/5', meta.classes)}
                  aria-label={`Open ${file.name}`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
                <button onClick={() => navigate(openPath(file))} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{file.name}</span>
                    <span className="hidden shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted sm:inline">
                      {file.kind === 'other' ? 'File' : file.kind}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-muted">
                    {humanSize(file.size)} · {humanDate(file.updatedAt)}
                  </span>
                </button>
                <div className="ml-auto flex w-full basis-full items-center justify-end gap-0.5 border-t border-line/60 pt-2 transition sm:w-auto sm:basis-auto sm:border-0 sm:pt-0 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                  <button className="icon-btn" onClick={() => toggleFavorite(file.id)} title="Favourite">
                    <Star className={clsx('h-3.5 w-3.5', file.favorite && 'fill-amber-400 text-amber-400')} />
                  </button>
                  <button className="icon-btn" onClick={() => startRename(file)} title="Rename">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className="icon-btn" onClick={() => download(file)} title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="icon-btn hover:text-rose-600"
                    onClick={async () => {
                      if (!window.confirm(`Delete “${file.name}”? Its version history is deleted too.`)) return;
                      await remove(file.id);
                      toast('Deleted');
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState
            compact
            icon={FolderOpen}
            title={q ? 'No documents match that search' : 'Your library is empty'}
            description={
              q
                ? 'Try a shorter search, or scroll down to the tool library.'
                : 'Create a document, or drop in a DOCX, XLSX, PPTX or PDF to start.'
            }
            action={
              <button className="btn-outline" onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Choose a file
              </button>
            }
          />
        </div>
      )}

      <section className="mt-10">
        <div className="flex flex-col gap-4 border-b border-line/70 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Toolkit</p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-ink">Tool library</h2>
            <p className="mt-1 text-xs text-ink-muted">
              {filteredTools.length} of {TOOLS.length} tools · {CATEGORIES.length} categories
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => document.getElementById(`cat-${category.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised/80 px-3 py-1.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:bg-raised hover:text-ink"
              >
                <span className={clsx('h-1.5 w-1.5 rounded-full', category.dot)} />
                {category.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-9">
          {CATEGORIES.map((category) => {
            const tools = toolsByCategory(category.id).filter((tool) => filteredTools.includes(tool));
            if (!tools.length) return null;
            const Icon = category.icon;
            return (
              <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-24">
                <div className="mb-3.5 flex items-start gap-3">
                  <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ring-1 ring-inset ring-black/5', category.iconBg, category.iconText)}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h3 className="font-display text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                      {category.name}
                      <span className="ml-2 font-normal normal-case tracking-normal text-ink-muted">{tools.length}</span>
                    </h3>
                    <p className="text-xs text-ink-muted">{category.description}</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {tools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} categoryClasses={category} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        {!filteredTools.length ? (
          <div className="mt-4">
            <EmptyState compact icon={Search} title="No tool matches that search" description="Try “PDF”, “sign”, “quiz” or “compress”." />
          </div>
        ) : null}
      </section>

      <footer className="mt-12 border-t border-line/70 pb-5 pt-6">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <BrandLogo variant="mark" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
            Powered by <span className="text-ink-soft">Bamania&apos;s Tech</span>
          </p>
          <p className="text-[9.5px] font-medium tracking-[0.08em] text-ink-muted/75">© 2026 Tech Bamania</p>
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-[11px] leading-relaxed text-ink-muted">
          Files live in this browser’s IndexedDB. Clearing site data removes them — download anything you need to keep.
        </p>
      </footer>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename document"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={commitRename}>
              Rename
            </button>
          </>
        }
      >
        <label className="label" htmlFor="rename-input">
          File name
        </label>
        <input
          id="rename-input"
          className="field"
          value={renameValue}
          autoFocus
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
          }}
        />
      </Modal>
    </div>
  );
}

function ToolCard({ tool, categoryClasses }: { tool: ToolDef; categoryClasses: (typeof CATEGORIES)[number] }) {
  const Icon = tool.icon;
  return (
    <Link
      to={`/tools/${tool.id}`}
      className="group relative flex items-start gap-3 rounded-xl border border-line/90 bg-raised/80 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-raised hover:shadow-lift dark:hover:border-brand-500/40"
    >
      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ring-1 ring-inset ring-black/5', categoryClasses.iconBg, categoryClasses.iconText)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-ink">{tool.name}</span>
          {tool.ai ? <Sparkles className="h-3 w-3 shrink-0 text-amber-500" /> : null}
          <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted opacity-0 transition group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-muted">{tool.description}</span>
      </span>
    </Link>
  );
}
