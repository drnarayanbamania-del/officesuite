import clsx from 'clsx';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Download,
  FileText,
  FileUp,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Printer,
  Redo2,
  RemoveFormatting,
  Save,
  Strikethrough,
  Table,
  Underline,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getFile } from '../lib/db';
import { downloadBytes, downloadText, humanDate, stripExt } from '../lib/files';
import { docxToHtml, escapeHtml, htmlToDocx, textToHtml, DOCX_MIME_TYPE } from '../lib/html-docx';
import { printHtml } from '../lib/print';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';

function ensureDocx(name: string): string {
  return /\.docx$/i.test(name) ? name : `${name || 'Untitled document'}.docx`;
}

export default function Writer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const storedFiles = useFiles((s) => s.files);
  const refresh = useFiles((s) => s.refresh);
  const saveFile = useFiles((s) => s.save);

  const editorRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef<string | null>(null);

  const [title, setTitle] = useState('Untitled document');
  const [fileId, setFileId] = useState<string | undefined>(id);
  const [html, setHtml] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [working, setWorking] = useState(false);
  const [missing, setMissing] = useState(false);
  const [stats, setStats] = useState({ words: 0, characters: 0, savedAt: 0 });

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoading(false);
      setTitle('Untitled document');
      setHtml('');
      setFileId(undefined);
      loadedRef.current = null;
      if (editorRef.current) editorRef.current.innerHTML = '';
      return;
    }
    if (loadedRef.current === id) return;
    setLoading(true);
    setMissing(false);
    (async () => {
      const file = await getFile(id);
      if (cancelled) return;
      if (!file) {
        setMissing(true);
        setLoading(false);
        return;
      }
      let content = '';
      const snapshot = file.meta?.html;
      if (typeof snapshot === 'string') {
        content = snapshot;
      } else if (/\.docx$/i.test(file.name) || file.mime === DOCX_MIME_TYPE) {
        try {
          content = await docxToHtml(file.bytes);
        } catch {
          content = textToHtml(new TextDecoder().decode(file.bytes).slice(0, 20000));
        }
      } else {
        content = textToHtml(new TextDecoder().decode(file.bytes).slice(0, 40000));
      }
      if (cancelled) return;
      setTitle(stripExt(file.name));
      setHtml(content);
      setFileId(file.id);
      setStats((s) => ({ ...s, savedAt: file.updatedAt }));
      setDirty(false);
      setLoading(false);
      loadedRef.current = id;
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html || '';
    updateStats();
  }, [html]);

  const updateStats = () => {
    const text = editorRef.current?.innerText ?? '';
    setStats((s) => ({
      ...s,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      characters: text.length,
    }));
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setDirty(true);
    setHtml(editorRef.current?.innerHTML ?? '');
    updateStats();
  };

  const save = async () => {
    const content = editorRef.current?.innerHTML ?? '';
    if (!content.replace(/<[^>]*>/g, '').trim() && !content.includes('<img')) {
      toast('Write something before saving', 'info');
      return;
    }
    setWorking(true);
    try {
      const settingsTitle = title.trim() || 'Untitled document';
      const bytes = await htmlToDocx(content, settingsTitle);
      const saved = await saveFile({
        id: fileId,
        name: ensureDocx(settingsTitle),
        kind: 'writer',
        bytes,
        mime: DOCX_MIME_TYPE,
        meta: { html: content },
      });
      setFileId(saved.id);
      setDirty(false);
      setStats((s) => ({ ...s, savedAt: saved.updatedAt }));
      loadedRef.current = saved.id;
      navigate(`/writer/${saved.id}`, { replace: true });
      toast('Document saved');
    } catch (error: any) {
      toast(error?.message ?? 'Could not save the document', 'error');
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const exportDocx = async () => {
    const content = editorRef.current?.innerHTML ?? '';
    if (!content.replace(/<[^>]*>/g, '').trim()) {
      toast('Nothing to export yet', 'info');
      return;
    }
    setWorking(true);
    try {
      const bytes = await htmlToDocx(content, title.trim() || 'Untitled document');
      downloadBytes(bytes, ensureDocx(title.trim()), DOCX_MIME_TYPE);
      toast('DOCX downloaded');
    } finally {
      setWorking(false);
    }
  };

  const exportPdf = () => {
    const content = editorRef.current?.innerHTML ?? '';
    if (!content.replace(/<[^>]*>/g, '').trim()) {
      toast('Nothing to print yet', 'info');
      return;
    }
    try {
      printHtml(content, title.trim() || 'Document');
    } catch (error: any) {
      toast(error?.message ?? 'Printing failed', 'error');
    }
  };

  const importFile = async (list: FileList | null) => {
    const input = list?.[0];
    if (!input) return;
    setWorking(true);
    try {
      const buffer = await input.arrayBuffer();
      let content: string;
      if (/\.docx$/i.test(input.name)) {
        content = await docxToHtml(buffer);
      } else if (/\.html?$/i.test(input.name)) {
        content = new TextDecoder().decode(buffer);
      } else {
        content = textToHtml(new TextDecoder().decode(buffer));
      }
      setTitle(stripExt(input.name));
      setHtml(content);
      setFileId(undefined);
      setDirty(true);
      loadedRef.current = null;
      toast(`Imported ${input.name}`);
    } catch (error: any) {
      toast(error?.message ?? 'Could not read this document', 'error');
    } finally {
      setWorking(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  const insertImage = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      exec('insertImage', String(reader.result));
      toast('Image inserted');
    };
    reader.readAsDataURL(file);
    if (imageRef.current) imageRef.current.value = '';
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <FileText className="mx-auto h-8 w-8 text-ink-muted" />
        <h1 className="mt-3 text-lg font-semibold text-ink">Document not found</h1>
        <p className="mt-1 text-sm text-ink-soft">It may have been deleted from this browser’s storage.</p>
        <Link className="btn-primary mt-4" to="/">
          Back to workspace
        </Link>
      </div>
    );
  }

  const lastSaved = stats.savedAt
    ? new Date(stats.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const thisFile = storedFiles.find((file) => file.id === fileId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--editor-canvas))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2 sm:px-4">
        <Link to="/" className="icon-btn" aria-label="Back to workspace">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold text-ink hover:border-line focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:text-sm"
          placeholder="Untitled document"
        />
        <span className="hidden text-[11px] text-ink-muted sm:inline">
          {dirty ? 'Unsaved changes' : lastSaved ? `Saved ${lastSaved}` : 'Not saved yet'}
        </span>
        <div className="flex w-full items-center justify-end gap-1 border-t border-line/60 pt-2 sm:w-auto sm:border-0 sm:pt-0">
          <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => importRef.current?.click()} disabled={working}>
            <FileUp className="h-3.5 w-3.5" /> Import
          </button>
          <input ref={importRef} type="file" accept=".docx,.txt,.md,.html,.htm" className="hidden" onChange={(e) => importFile(e.target.files)} />
          <button className="btn-ghost px-2 py-1.5 text-xs" onClick={exportPdf}>
            <Printer className="h-3.5 w-3.5" /> PDF
          </button>
          <button className="btn-ghost px-2 py-1.5 text-xs" onClick={exportDocx} disabled={working}>
            <Download className="h-3.5 w-3.5" /> DOCX
          </button>
          <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={save} disabled={working}>
            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {working ? 'Working…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-raised px-2 py-1.5 sm:px-3">
        <div className="flex items-center gap-0.5 border-r border-line pr-1.5">
          <ToolbarButton label="Undo" onClick={() => exec('undo')}>
            <Undo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Redo" onClick={() => exec('redo')}>
            <Redo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
        <select
          className="mx-1.5 h-7 rounded-md border border-line bg-raised px-1.5 text-[11px] text-ink"
          defaultValue="p"
          onChange={(event) => exec('formatBlock', event.target.value)}
          aria-label="Paragraph style"
        >
          <option value="p">Normal</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
        </select>
        <div className="flex items-center gap-0.5 border-x border-line px-1.5">
          <ToolbarButton label="Bold" onClick={() => exec('bold')}>
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Italic" onClick={() => exec('italic')}>
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Underline" onClick={() => exec('underline')}>
            <Underline className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Strikethrough" onClick={() => exec('strikeThrough')}>
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>
          <input
            type="color"
            className="h-7 w-7 cursor-pointer rounded border border-line bg-raised p-0.5"
            onChange={(event) => exec('foreColor', event.target.value)}
            title="Text colour"
            aria-label="Text colour"
          />
        </div>
        <div className="flex items-center gap-0.5 px-1.5">
          <ToolbarButton label="Bulleted list" onClick={() => exec('insertUnorderedList')}>
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Numbered list" onClick={() => exec('insertOrderedList')}>
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-0.5 border-l border-line pl-1.5">
          <ToolbarButton label="Align left" onClick={() => exec('justifyLeft')}>
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Align centre" onClick={() => exec('justifyCenter')}>
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Align right" onClick={() => exec('justifyRight')}>
            <AlignRight className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Justify" onClick={() => exec('justifyFull')}>
            <AlignJustify className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-0.5 border-l border-line pl-1.5">
          <ToolbarButton
            label="Insert table"
            onClick={() =>
              exec(
                'insertHTML',
                '<table><tbody>' +
                  Array.from({ length: 3 })
                    .map(() => `<tr>${Array.from({ length: 3 }).map(() => '<td><br></td>').join('')}</tr>`)
                    .join('') +
                  '</tbody></table><p><br></p>'
              )
            }
          >
            <Table className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Insert image" onClick={() => imageRef.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" />
          </ToolbarButton>
          <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => insertImage(e.target.files)} />
          <ToolbarButton
            label="Insert link"
            onClick={() => {
              const url = window.prompt('Link URL', 'https://');
              if (url) exec('createLink', url);
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Clear formatting" onClick={() => exec('removeFormat')}>
            <RemoveFormatting className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-6 sm:px-6" onClick={() => editorRef.current?.focus()}>
        {loading ? (
          <div className="mx-auto flex max-w-[820px] items-center justify-center gap-2 rounded-lg border border-line bg-white py-24 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening document…
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[820px]">
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-ink-muted">
              <span>{thisFile ? thisFile.name : 'Not in library yet'}</span>
              <span>{thisFile ? `Edited ${humanDate(thisFile.updatedAt)}` : ''}</span>
            </div>
            <div
              ref={editorRef}
              className="doc-surface min-h-[1050px] rounded-md border border-line bg-white px-10 py-12 shadow-lift outline-none sm:px-16"
              contentEditable
              suppressContentEditableWarning
              spellCheck
              onInput={() => {
                setDirty(true);
                setHtml(editorRef.current?.innerHTML ?? '');
                updateStats();
              }}
              onBlur={() => updateStats()}
              style={{ fontFamily: '"Segoe UI", Calibri, Arial, sans-serif', fontSize: 15, lineHeight: 1.65 }}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-muted">
              <span>
                {stats.words} words · {stats.characters} characters
              </span>
              <span>Autosave is off — press Ctrl+S or Save to write a version</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-sunken hover:text-ink"
    >
      {children}
    </button>
  );
}
