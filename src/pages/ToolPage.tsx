import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileCheck2,
  Loader2,
  Play,
  Save,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { loadAIConfig, isAIReady, type AIConfig } from '../lib/ai';
import { getFile, listVersions, deleteVersion, type FileVersion, type StoredFile } from '../lib/db';
import { downloadBytes, humanDate, humanSize, kindOf } from '../lib/files';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';
import { FilePicker, type PickedFile } from '../components/FilePicker';
import { Badge, EmptyState, Modal, Progress, Spinner } from '../components/ui';
import PageOrganizer from '../components/PageOrganizer';
import OcrWorkspace from './OcrWorkspace';
import { CATEGORIES, TOOL_BY_ID, defaultsFor, type ToolOption } from '../tools/registry';
import { runTool, type OutputFile, type RunResult } from '../tools/run';

export default function ToolPage() {
  const { toolId = '' } = useParams();
  const tool = TOOL_BY_ID[toolId];
  const category = CATEGORIES.find((c) => c.id === tool?.category);
  const navigate = useNavigate();
  const saveToLibrary = useFiles((s) => s.save);

  const [files, setFiles] = useState<PickedFile[]>([]);
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => defaultsFor(tool));
  const [ai, setAI] = useState<AIConfig | null>(null);
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<OutputFile | null>(null);

  useEffect(() => {
    setFiles([]);
    setValues(defaultsFor(tool));
    setResult(null);
    setError(null);
    setProgress({ value: 0, label: '' });
  }, [toolId, tool]);

  useEffect(() => {
    loadAIConfig().then(setAI);
  }, [toolId]);

  if (!tool) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <EmptyState
          icon={FileCheck2}
          title="Tool not found"
          description="This tool does not exist or has been renamed."
          action={
            <Link className="btn-primary" to="/">
              Back to workspace
            </Link>
          }
        />
      </div>
    );
  }

  if (tool.launch === 'ocr') return <OcrWorkspace />;

  const Icon = tool.icon;
  const needsMoreFiles = tool.multiple && tool.minFiles ? files.length < tool.minFiles : files.length === 0;

  const run = async () => {
    if (!files.length) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ value: 0.02, label: 'Preparing' });
    try {
      const output = await runTool({
        toolId: tool.id,
        files,
        options: values,
        ai,
        onProgress: (value, label) => setProgress({ value, label: label ?? '' }),
      });
      setResult(output);
      setProgress({ value: 1, label: 'Done' });
      if (!output.outputs.length) toast('Finished, but nothing could be produced', 'info');
      else toast('Processing complete');
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong while processing this file.');
      setProgress({ value: 0, label: '' });
    } finally {
      setRunning(false);
    }
  };

  const saveOutput = async (output: OutputFile) => {
    const kind = kindOf(output.name, output.mime);
    const saved = await saveToLibrary({ name: output.name, kind, bytes: output.bytes, mime: output.mime });
    toast(`Saved ${saved.name} to your library`);
    setLibraryTarget(null);
  };

  const launch = async () => {
    if (!files.length) return;
    if (tool.launch === 'pdf-viewer') {
      const saved = await saveToLibrary({
        name: files[0].name,
        kind: 'pdf',
        bytes: files[0].bytes,
        mime: 'application/pdf',
      });
      const mode = tool.viewerMode ?? 'highlight';
      navigate(`/pdf/${saved.id}?mode=${mode}`);
      return;
    }
    if (tool.launch === 'organizer') {
      setResult(null);
      return;
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-xs text-ink-muted">
        <Link to="/" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-sunken hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Workspace
        </Link>
        <span>/</span>
        <span className="text-ink-soft">{category?.name}</span>
        <span>/</span>
        <span className="text-ink">{tool.name}</span>
      </div>

      <header className="mb-5 flex items-start gap-3.5">
        <span className={clsx('grid h-12 w-12 shrink-0 place-items-center rounded-xl', category?.iconBg, category?.iconText)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-semibold tracking-tight text-ink">{tool.name}</h1>
            {tool.ai ? (
              <Badge tone="amber">
                <Sparkles className="h-3 w-3" /> AI-assisted
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">{tool.description}</p>
        </div>
      </header>

      {tool.ai && !isAIReady(ai) ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">No AI provider configured.</p>
            <p className="mt-0.5">
              {tool.id === 'translate'
                ? 'Translation requires an OpenAI-compatible provider. Add one in Settings.'
                : 'This tool will run its offline study engine instead — results come from the document’s own sentences. Add a provider in Settings for generative output.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Source file</h2>
            <FilePicker accept={tool.accept} multiple={tool.multiple} files={files} onChange={setFiles} />
            {tool.multiple && tool.minFiles ? (
              <p className="mt-2 text-[11px] text-ink-muted">
                {files.length} selected · at least {tool.minFiles} required
              </p>
            ) : null}
          </section>

          {tool.options?.length ? (
            <section className="card p-4">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Options</h2>
              <div className="space-y-3.5">
                {tool.options.map((option) => (
                  <OptionField
                    key={option.key}
                    option={option}
                    value={values[option.key]}
                    onChange={(value) => setValues((current) => ({ ...current, [option.key]: value }))}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {tool.launch === 'versions' ? (
            <VersionPanel files={files} />
          ) : tool.launch === 'pdf-viewer' ? (
            <button className="btn-primary w-full" disabled={!files.length} onClick={launch}>
              <ExternalLink className="h-4 w-4" /> Open annotation workspace
            </button>
          ) : tool.launch === 'organizer' ? (
            files.length ? (
              <PageOrganizer file={files[0]} />
            ) : (
              <p className="text-xs text-ink-muted">Add a PDF above to arrange its pages.</p>
            )
          ) : tool.id === 'open-with' ? (
            <OpenWith files={files} />
          ) : (
            <div className="space-y-2">
              <button className="btn-primary w-full" disabled={needsMoreFiles || running} onClick={run}>
                {running ? <Spinner /> : <Play className="h-4 w-4" />}
                {running ? 'Processing…' : 'Run tool'}
              </button>
              {running ? <Progress value={progress.value} label={progress.label || 'Working…'} /> : null}
              {tool.outputNote ? <p className="text-[11px] leading-relaxed text-ink-muted">{tool.outputNote}</p> : null}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-sm text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Could not complete this run</p>
                  <p className="mt-1 text-xs leading-relaxed">{error}</p>
                </div>
              </div>
            </div>
          ) : null}

          {!result && !error && !tool.launch ? (
            <section className="card flex min-h-[260px] flex-col items-center justify-center p-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-sunken text-ink-muted">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink">Results appear here</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-muted">
                Choose a source, adjust the options, then run the tool. Nothing is uploaded — processing uses this device’s
                CPU.
              </p>
            </section>
          ) : null}

          {result ? (
            <>
              <section className="card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Output</h2>
                  <Badge tone="green">
                    <Check className="h-3 w-3" /> Complete
                  </Badge>
                </div>
                {result.summary ? <p className="mb-3 text-sm leading-relaxed text-ink-soft">{result.summary}</p> : null}
                {result.outputs.length ? (
                  <ul className="space-y-2">
                    {result.outputs.map((output, index) => (
                      <li key={`${output.name}-${index}`} className="rounded-lg border border-line bg-sunken/40 p-3">
                        <div className="flex items-center gap-2">
                          <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-ink">{output.name}</p>
                            <p className="text-[11px] text-ink-muted">
                              {output.label ? `${output.label} · ` : ''}
                              {humanSize(output.bytes.byteLength)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            className="btn-outline px-2.5 py-1 text-[11px]"
                            onClick={() => downloadBytes(output.bytes, output.name, output.mime)}
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </button>
                          <button className="btn-ghost px-2.5 py-1 text-[11px]" onClick={() => saveOutput(output)}>
                            <Save className="h-3.5 w-3.5" /> Save to library
                          </button>
                          {output.mime.startsWith('image/') ? <OutputImage output={output} /> : null}
                        </div>
                        <OutputPreview output={output} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-muted">No downloadable file was produced for this run.</p>
                )}
              </section>

              {result.notes.length ? (
                <section className="card p-4">
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Notes</h2>
                  <ul className="space-y-1.5">
                    {result.notes.map((note, index) => (
                      <li key={index} className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                        {note}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {result.data ? <DataPreview data={result.data} /> : null}
            </>
          ) : null}

          {tool.launch === 'versions' && !result ? null : null}
        </div>
      </div>

      <Modal open={Boolean(libraryTarget)} onClose={() => setLibraryTarget(null)} title="Saved to library" width="max-w-sm">
        <p className="text-sm text-ink-soft">
          {libraryTarget?.name} is now in your library. Choose where to go next.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="btn-primary" to="/" onClick={() => setLibraryTarget(null)}>
            Go to workspace
          </Link>
          <button className="btn-ghost" onClick={() => setLibraryTarget(null)}>
            Stay here
          </button>
        </div>
      </Modal>
    </div>
  );
}

function OptionField({
  option,
  value,
  onChange,
}: {
  option: ToolOption;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  if (option.type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <span className="block text-[13px] font-medium text-ink">{option.label}</span>
          {option.help ? <span className="block text-[11px] text-ink-muted">{option.help}</span> : null}
        </span>
      </label>
    );
  }
  return (
    <div>
      <label className="label" htmlFor={`opt-${option.key}`}>
        {option.label}
      </label>
      {option.type === 'select' ? (
        <select
          id={`opt-${option.key}`}
          className="field"
          value={String(value ?? option.default)}
          onChange={(event) => onChange(event.target.value)}
        >
          {option.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : option.type === 'textarea' ? (
        <textarea
          id={`opt-${option.key}`}
          className="field min-h-[90px] resize-y"
          value={String(value ?? '')}
          placeholder={option.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : option.type === 'number' ? (
        <input
          id={`opt-${option.key}`}
          type="number"
          className="field tabular-nums"
          value={Number(value ?? option.default)}
          min={option.min}
          max={option.max}
          step={option.step ?? 1}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : (
        <input
          id={`opt-${option.key}`}
          className="field"
          value={String(value ?? '')}
          placeholder={option.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {option.help ? <p className="mt-1 text-[11px] leading-snug text-ink-muted">{option.help}</p> : null}
    </div>
  );
}

function OutputImage({ output }: { output: OutputFile }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([output.bytes], { type: output.mime }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [output]);
  if (!url) return null;
  return (
    <a className="btn-ghost px-2.5 py-1 text-[11px]" href={url} target="_blank" rel="noreferrer">
      <ExternalLink className="h-3.5 w-3.5" /> Preview
    </a>
  );
}

function OutputPreview({ output }: { output: OutputFile }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const isText =
      output.mime.startsWith('text/') ||
      output.mime === 'application/json' ||
      output.mime === 'image/svg+xml';
    if (isText && output.bytes.byteLength < 200000) {
      setText(new TextDecoder().decode(output.bytes));
    } else {
      setText(null);
    }
  }, [output]);
  if (!text) return null;
  if (output.mime === 'image/svg+xml') {
    return (
      <div
        className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-white p-2"
        dangerouslySetInnerHTML={{ __html: text }}
      />
    );
  }
  if (output.mime === 'application/json') {
    return (
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-line bg-sunken/50 p-2 text-[10px] leading-relaxed text-ink-soft">
        {text}
      </pre>
    );
  }
  return (
    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken/50 p-2 text-[10.5px] leading-relaxed text-ink-soft">
      {text.slice(0, 4000)}
    </pre>
  );
}

function DataPreview({ data }: { data: NonNullable<RunResult['data']> }) {
  const [showAnswers, setShowAnswers] = useState(false);
  return (
    <>
      {data.summary || (data.bullets && data.bullets.length) ? (
        <section className="card p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Summary</h2>
          {data.summary ? <p className="text-sm leading-relaxed text-ink-soft">{data.summary}</p> : null}
          {data.bullets?.length ? (
            <ul className="mt-2 space-y-1">
              {data.bullets.map((bullet, index) => (
                <li key={index} className="flex gap-2 text-xs leading-relaxed text-ink-soft">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                  {bullet}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {data.flashcards?.length ? (
        <section className="card p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            Flashcards ({data.flashcards.length})
          </h2>
          <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {data.flashcards.map((card, index) => (
              <li key={index} className="rounded-lg border border-line bg-sunken/40 p-2.5">
                <p className="text-xs font-medium leading-snug text-ink">{card.front}</p>
                <p className="mt-1 border-t border-line pt-1 text-[11px] leading-relaxed text-ink-soft">{card.back}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.quiz?.length ? (
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Quiz ({data.quiz.length})
            </h2>
            <button className="btn-ghost px-2 py-1 text-[11px]" onClick={() => setShowAnswers((s) => !s)}>
              {showAnswers ? 'Hide answers' : 'Show answers'}
            </button>
          </div>
          <ul className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {data.quiz.map((item, index) => (
              <li key={index} className="rounded-lg border border-line bg-sunken/40 p-2.5">
                <p className="text-xs font-medium leading-snug text-ink">
                  {index + 1}. {item.question}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {item.options.map((option, optionIndex) => (
                    <li
                      key={optionIndex}
                      className={clsx(
                        'rounded px-1.5 py-0.5 text-[11px]',
                        showAnswers && optionIndex === item.answer
                          ? 'bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'text-ink-soft'
                      )}
                    >
                      {String.fromCharCode(65 + optionIndex)}. {option}
                    </li>
                  ))}
                </ul>
                {showAnswers && item.explanation ? (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">{item.explanation}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.info ? (
        <section className="card p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Properties</h2>
          <dl className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
            {Object.entries(data.info).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2 rounded-lg bg-sunken/50 px-2 py-1.5">
                <dt className="text-ink-muted">{key}</dt>
                <dd className="truncate text-right font-medium text-ink">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {data.text && !data.summary ? (
        <section className="card p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Text preview</h2>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken/50 p-2 text-[11px] leading-relaxed text-ink-soft">
            {data.text.slice(0, 6000)}
          </pre>
        </section>
      ) : null}
    </>
  );
}

function VersionPanel({ files }: { files: PickedFile[] }) {
  const [target, setTarget] = useState<StoredFile | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const allFiles = useFiles((s) => s.files);
  const save = useFiles((s) => s.save);

  useEffect(() => {
    if (!files.length) return;
    setLoading(true);
    listVersions(files[0].name)
      .then(setVersions)
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [files]);

  useEffect(() => {
    if (!files.length) {
      const match = allFiles[0];
      if (match) setTarget(match);
    }
  }, [files, allFiles]);

  const chosen = target ?? allFiles.find((f) => f.name === files[0]?.name) ?? null;

  useEffect(() => {
    if (!chosen) return;
    setLoading(true);
    listVersions(chosen.id)
      .then(setVersions)
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [chosen?.id]);

  if (!allFiles.length) {
    return <p className="text-xs text-ink-muted">Create or open a document first; then its save points appear here.</p>;
  }

  return (
    <section className="card p-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Version history</h2>
      <select
        className="field mb-3"
        value={chosen?.id ?? ''}
        onChange={(event) => setTarget(allFiles.find((f) => f.id === event.target.value) ?? null)}
      >
        {allFiles.map((file) => (
          <option key={file.id} value={file.id}>
            {file.name}
          </option>
        ))}
      </select>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading save points…
        </p>
      ) : versions.length ? (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {versions.map((version) => (
            <li key={version.id} className="rounded-lg border border-line bg-sunken/40 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink">{version.note ?? 'Save point'}</p>
                  <p className="text-[10.5px] text-ink-muted">
                    {humanDate(version.createdAt)} · {humanSize(version.size)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    className="icon-btn h-7 w-7"
                    title="Download this version"
                    onClick={() => downloadBytes(version.bytes, `${version.name}.v${version.createdAt}.bak`, chosen?.mime)}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="icon-btn h-7 w-7"
                    title="Restore this version"
                    onClick={async () => {
                      if (!chosen) return;
                      await save({ id: chosen.id, name: chosen.name, kind: chosen.kind, bytes: version.bytes, mime: chosen.mime });
                      toast('Version restored');
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="icon-btn h-7 w-7 hover:text-rose-600"
                    title="Delete this save point"
                    onClick={async () => {
                      await deleteVersion(version.id);
                      setVersions((current) => current.filter((v) => v.id !== version.id));
                      toast('Save point deleted');
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-relaxed text-ink-muted">
          No save points yet. Each time you save a document in Writer, Sheets or Slides, the previous bytes are kept here.
        </p>
      )}
    </section>
  );
}

function OpenWith({ files }: { files: PickedFile[] }) {
  const supported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  const exportFile = async (openAfter = false) => {
    if (!files.length) return;
    const file = files[0];
    const blob = new Blob([file.bytes], { type: 'application/pdf' });
    if (openAfter) {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }
    if (supported) {
      try {
        const handle = await (window as any).showSaveFilePicker({ suggestedName: file.name });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        toast('File saved to disk');
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }
    downloadBytes(file.bytes, file.name);
    toast('Downloaded — open it with your desktop app');
  };

  return (
    <section className="card space-y-2 p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Hand off the file</h2>
      <p className="text-xs leading-relaxed text-ink-muted">
        {supported
          ? 'Your browser can write straight to disk. Use Save a copy, then open it in Word, Excel or Acrobat.'
          : 'This browser cannot pick a save location, so the file downloads to your default folder.'}
      </p>
      <button className="btn-primary w-full" disabled={!files.length} onClick={() => exportFile(false)}>
        <Download className="h-4 w-4" /> Save a copy to disk
      </button>
      <button className="btn-outline w-full" disabled={!files.length} onClick={() => exportFile(true)}>
        <ExternalLink className="h-4 w-4" /> Open in a browser tab
      </button>
    </section>
  );
}
