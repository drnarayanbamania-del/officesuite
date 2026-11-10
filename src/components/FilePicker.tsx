import clsx from 'clsx';
import { FileText, FolderOpen, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { getFile } from '../lib/db';
import { extOf, humanSize } from '../lib/files';
import { useFiles } from '../store/files';
import { EmptyState, Modal } from './ui';

export interface PickedFile {
  name: string;
  bytes: ArrayBuffer;
}

export function FilePicker({
  accept,
  multiple,
  files,
  onChange,
}: {
  accept: string;
  multiple?: boolean;
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stored = useFiles((s) => s.files);

  const acceptedExts = accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.startsWith('.'))
    .map((s) => s.slice(1));
  const acceptsImages = accept.includes('image/') || accept === '*';
  const acceptsAll = accept === '*';

  const matches = (name: string) => {
    if (acceptsAll) return true;
    const ext = extOf(name);
    if (acceptsImages && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return true;
    return acceptedExts.includes(ext);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const additions: PickedFile[] = [];
    for (const file of Array.from(list)) {
      additions.push({ name: file.name, bytes: await file.arrayBuffer() });
    }
    onChange(multiple ? [...files, ...additions] : additions.slice(0, 1));
    if (inputRef.current) inputRef.current.value = '';
  };

  const addFromLibrary = async (ids: string[]) => {
    const picks: PickedFile[] = [];
    for (const id of ids) {
      const file = await getFile(id);
      if (file) picks.push({ name: file.name, bytes: file.bytes });
    }
    onChange(multiple ? [...files, ...picks] : picks.slice(0, 1));
    setLibraryOpen(false);
  };

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={clsx(
          'rounded-xl border-2 border-dashed px-4 py-7 text-center transition',
          dragging ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-line-strong bg-sunken/40'
        )}
      >
        <span className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full bg-raised text-ink-soft shadow-card">
          <Upload className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-ink">Drop a file here</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {accept === '*' ? 'Any file type' : accept.replace(/\./g, '').replace(/,/g, ' · ').toUpperCase()}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button className="btn-outline text-xs" onClick={() => inputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Choose file
          </button>
          <button className="btn-ghost text-xs" onClick={() => setLibraryOpen(true)}>
            <FolderOpen className="h-3.5 w-3.5" /> From library
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
      </div>

      {files.length ? (
        <ul className="mt-3 space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-2"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{file.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{humanSize(file.bytes.byteLength)}</span>
              <button
                className="icon-btn h-6 w-6"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} title="Choose from your library" width="max-w-xl">
        {stored.length ? (
          <ul className="space-y-1.5">
            {stored.map((file) => {
              const allowed = matches(file.name);
              return (
                <li key={file.id}>
                  <button
                    disabled={!allowed}
                    onClick={() => addFromLibrary([file.id])}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition',
                      allowed
                        ? 'border-line hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-500/10'
                        : 'cursor-not-allowed border-line opacity-40'
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{file.name}</span>
                      <span className="text-[11px] text-ink-muted">
                        {humanSize(file.size)} · {file.kind}
                      </span>
                    </span>
                    {!allowed ? <span className="text-[10px] uppercase text-ink-muted">unsupported</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={FolderOpen} title="Nothing in the library yet" description="Upload a file to get started." />
        )}
      </Modal>
    </div>
  );
}
