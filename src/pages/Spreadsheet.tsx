import clsx from 'clsx';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Download,
  FileSpreadsheet,
  FileUp,
  Italic,
  Loader2,
  Plus,
  Save,
  Trash2,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { getFile } from '../lib/db';
import { downloadBytes, humanDate, stripExt, uid } from '../lib/files';
import {
  cellId,
  columnIndex,
  columnLabel,
  displayValue,
  evaluateWorkbook,
  nextCell,
  sheetToMatrix,
  type CellResult,
} from '../lib/formula';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const COLS = 16;
const INITIAL_ROWS = 60;

interface CellStyle {
  b?: boolean;
  i?: boolean;
  align?: 'left' | 'center' | 'right';
  bg?: string;
}

interface SheetModel {
  id: string;
  name: string;
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
}

function newSheet(name = 'Sheet1'): SheetModel {
  return { id: uid('sheet'), name, cells: {}, styles: {} };
}

function parseWorkbookBytes(bytes: ArrayBuffer, fileName: string): SheetModel[] {
  const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' });
  return wb.SheetNames.map((name) => {
    const worksheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false, raw: true });
    const cells: Record<string, string> = {};
    rows.forEach((row, r) => {
      (row ?? []).forEach((value, c) => {
        if (value === null || value === undefined || value === '') return;
        cells[cellId(c, r)] = String(value);
      });
    });
    return { id: uid('sheet'), name, cells, styles: {} };
  });
}

export default function Spreadsheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const saveFile = useFiles((s) => s.save);
  const refresh = useFiles((s) => s.refresh);

  const [book, setBook] = useState<SheetModel[]>(() => [newSheet()]);
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState({ row: 0, col: 0 });
  const [editCell, setEditCell] = useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [title, setTitle] = useState('Untitled spreadsheet');
  const [fileId, setFileId] = useState<string | undefined>(id);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
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
        setNotice('This spreadsheet is not in the library any more.');
        setLoading(false);
        return;
      }
      try {
        const snapshot = file.meta?.book as SheetModel[] | undefined;
        if (Array.isArray(snapshot) && snapshot.length) {
          setBook(
            snapshot.map((sheet) => ({
              id: sheet.id ?? uid('sheet'),
              name: sheet.name ?? 'Sheet',
              cells: sheet.cells ?? {},
              styles: sheet.styles ?? {},
            }))
          );
        } else {
          setBook(parseWorkbookBytes(file.bytes, file.name));
        }
        setTitle(stripExt(file.name));
        setFileId(file.id);
        setActive(0);
        loadedRef.current = id;
      } catch (error: any) {
        setNotice(error?.message ?? 'Could not read this spreadsheet.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const computed = useMemo(
    () => evaluateWorkbook(book.map((sheet) => ({ name: sheet.name, cells: sheet.cells }))),
    [book]
  );

  const sheet = book[active] ?? book[0];
  const results = computed[sheet?.name] ?? {};
  const selectedId = cellId(selection.col, selection.row);
  const selectedResult: CellResult | undefined = results[selectedId];
  const selectedRaw = sheet?.cells[selectedId] ?? '';

  const setCell = (row: number, col: number, value: string) => {
    const target = cellId(col, row);
    setBook((current) =>
      current.map((item, index) => {
        if (index !== active) return item;
        const cells = { ...item.cells };
        if (value === '') delete cells[target];
        else cells[target] = value;
        return { ...item, cells };
      })
    );
    setDirty(true);
  };

  const updateStyle = (patch: CellStyle) => {
    const target = cellId(selection.col, selection.row);
    setBook((current) =>
      current.map((item, index) => {
        if (index !== active) return item;
        const existing = item.styles[target] ?? {};
        return { ...item, styles: { ...item.styles, [target]: { ...existing, ...patch } } };
      })
    );
    setDirty(true);
  };

  const move = (direction: 'down' | 'up' | 'right' | 'left') => {
    const next = nextCell(selectedId, direction);
    const match = next.match(/^([A-Z]+)(\d+)$/);
    if (!match) return;
    const col = columnIndex(match[1]);
    const row = Number(match[2]) - 1;
    if (row >= rows) setRows(row + 12);
    setSelection({ row, col });
    setEditCell(null);
  };

  const startEdit = (row = selection.row, col = selection.col, initial?: string) => {
    setSelection({ row, col });
    setEditCell({ row, col });
    setDraft(initial ?? sheet?.cells[cellId(col, row)] ?? '');
    gridRef.current?.focus();
  };

  const commitEdit = (then?: 'down' | 'right' | 'none') => {
    if (!editCell) return;
    setCell(editCell.row, editCell.col, draft);
    setEditCell(null);
    setDraft('');
    if (then === 'down') move('down');
    if (then === 'right') move('right');
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editCell) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move('down');
        break;
      case 'ArrowUp':
        event.preventDefault();
        move('up');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        move('right');
        break;
      case 'Enter':
        event.preventDefault();
        startEdit();
        break;
      case 'Tab':
        event.preventDefault();
        move('right');
        break;
      case 'F2':
        event.preventDefault();
        startEdit();
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        setCell(selection.row, selection.col, '');
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          startEdit(selection.row, selection.col, event.key);
        }
    }
  };

  const buildWorkbookBytes = (): ArrayBuffer => {
    const workbook = XLSX.utils.book_new();
    for (const item of book) {
      const itemResults = computed[item.name] ?? {};
      const keys = Object.keys(item.cells);
      const maxRow = Math.max(20, ...keys.map((key) => Number(key.match(/\d+/)?.[0] ?? 0)));
      const maxCol = Math.max(8, ...keys.map((key) => columnIndex(key.match(/[A-Z]+/)?.[0] ?? 'A') + 1));
      const matrix = sheetToMatrix(item.cells, itemResults, maxRow, maxCol);
      const worksheet = XLSX.utils.aoa_to_sheet(matrix);
      worksheet['!cols'] = Array.from({ length: maxCol }, (_, index) => ({
        wch: Math.min(40, Math.max(12, ...matrix.map((row) => String(row[index] ?? '').length + 2))),
      }));
      XLSX.utils.book_append_sheet(workbook, worksheet, item.name.slice(0, 31));
    }
    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  };

  const save = async () => {
    setSaving(true);
    try {
      const bytes = buildWorkbookBytes();
      const saved = await saveFile({
        id: fileId,
        name: /\.xlsx$/i.test(title) ? title : `${title.trim() || 'Untitled spreadsheet'}.xlsx`,
        kind: 'sheet',
        bytes,
        mime: XLSX_MIME,
        meta: { book },
      });
      setFileId(saved.id);
      setDirty(false);
      loadedRef.current = saved.id;
      navigate(`/sheet/${saved.id}`, { replace: true });
      toast('Spreadsheet saved');
    } catch (error: any) {
      toast(error?.message ?? 'Could not save the workbook', 'error');
    } finally {
      setSaving(false);
    }
  };

  const importFile = async (list: FileList | null) => {
    const input = list?.[0];
    if (!input) return;
    try {
      const bytes = await input.arrayBuffer();
      const sheets = parseWorkbookBytes(bytes, input.name);
      setBook(sheets);
      setActive(0);
      setTitle(stripExt(input.name));
      setFileId(undefined);
      setDirty(true);
      loadedRef.current = null;
      toast(`Imported ${input.name}`);
    } catch (error: any) {
      toast(error?.message ?? 'Could not read this spreadsheet', 'error');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const addSheet = () => {
    setBook((current) => [...current, newSheet(`Sheet${current.length + 1}`)]);
    setActive(book.length);
    setDirty(true);
  };

  const renameSheet = () => {
    const name = window.prompt('Sheet name', sheet.name);
    if (!name) return;
    setBook((current) => current.map((item, index) => (index === active ? { ...item, name } : item)));
    setDirty(true);
  };

  const deleteSheet = () => {
    if (book.length === 1) {
      toast('A workbook needs at least one sheet', 'info');
      return;
    }
    if (!window.confirm(`Delete sheet “${sheet.name}”?`)) return;
    setBook((current) => current.filter((_, index) => index !== active));
    setActive(0);
    setDirty(true);
  };

  const exportCsv = () => {
    const keys = Object.keys(sheet.cells);
    const maxRow = Math.max(1, ...keys.map((key) => Number(key.match(/\d+/)?.[0] ?? 1)));
    const maxCol = Math.max(1, ...keys.map((key) => columnIndex(key.match(/[A-Z]+/)?.[0] ?? 'A') + 1));
    const matrix = sheetToMatrix(sheet.cells, results, maxRow, maxCol);
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    downloadBytes(new TextEncoder().encode(XLSX.utils.sheet_to_csv(worksheet)).buffer as ArrayBuffer, `${stripExt(title)}-${sheet.name}.csv`, 'text/csv');
  };

  const thisFile = useFiles((s) => s.files.find((f) => f.id === fileId));

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--editor-canvas))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2 sm:px-4">
        <Link to="/" className="icon-btn" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <FileSpreadsheet className="h-4 w-4" />
        </span>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-ink hover:border-line focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <span className="hidden text-[11px] text-ink-muted sm:inline">
          {dirty ? 'Unsaved changes' : thisFile ? `Saved ${humanDate(thisFile.updatedAt)}` : 'Not saved yet'}
        </span>
        <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => importRef.current?.click()}>
          <FileUp className="h-3.5 w-3.5" /> Import
        </button>
        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => importFile(event.target.files)} />
        <button className="btn-ghost px-2 py-1.5 text-xs" onClick={exportCsv}>
          CSV
        </button>
        <button
          className="btn-ghost px-2 py-1.5 text-xs"
          onClick={() => downloadBytes(buildWorkbookBytes(), `${title || 'workbook'}.xlsx`, XLSX_MIME)}
        >
          <Download className="h-3.5 w-3.5" /> XLSX
        </button>
        <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-raised px-2 py-1.5 sm:px-3">
        <button onClick={() => updateStyle({ b: !sheet.styles[selectedId]?.b })} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-sunken" title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => updateStyle({ i: !sheet.styles[selectedId]?.i })} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-sunken" title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={() => updateStyle({ align: 'left' })} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-sunken" title="Align left">
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => updateStyle({ align: 'center' })} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-sunken" title="Align centre">
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => updateStyle({ align: 'right' })} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-sunken" title="Align right">
          <AlignRight className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <label className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
          <Type className="h-3.5 w-3.5" />
          <input
            type="color"
            className="h-6 w-6 cursor-pointer rounded border border-line bg-raised p-0.5"
            onChange={(event) => updateStyle({ bg: event.target.value })}
            title="Cell background"
          />
        </label>
        <button
          onClick={() => updateStyle({ b: false, i: false, align: undefined, bg: undefined })}
          className="ml-1 rounded-md px-2 py-1 text-[11px] text-ink-soft hover:bg-sunken"
        >
          Clear style
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={addSheet} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft hover:bg-sunken">
          <Plus className="h-3.5 w-3.5" /> Sheet
        </button>
        <button onClick={renameSheet} className="rounded-md px-2 py-1 text-[11px] text-ink-soft hover:bg-sunken">
          Rename
        </button>
        <button onClick={deleteSheet} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft hover:bg-sunken hover:text-rose-600">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
        <span className="ml-auto text-[10.5px] text-ink-muted">{Object.keys(sheet?.cells ?? {}).length} filled cells</span>
      </div>

      <div className="flex items-center gap-2 border-b border-line bg-raised px-2 py-1">
        <span className="w-16 shrink-0 rounded border border-line bg-sunken/60 px-1 py-0.5 text-center font-mono text-[11px] text-ink-soft">
          {selectedId}
        </span>
        <span className="shrink-0 text-[11px] italic text-ink-muted">fx</span>
        <input
          value={selectedRaw}
          onChange={(event) => setCell(selection.row, selection.col, event.target.value)}
          placeholder="Enter a value or formula, e.g. =SUM(A1:A10)"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-muted"
          spellCheck={false}
        />
        <span className={clsx('hidden shrink-0 text-[11px] sm:block', selectedResult?.error ? 'text-rose-600' : 'text-ink-muted')}>
          {displayValue(selectedResult) || 'empty'}
        </span>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        className="min-h-0 flex-1 overflow-auto bg-raised outline-none"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening workbook…
          </div>
        ) : (
          <table className="border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-7 w-10 border border-line bg-sunken text-[10px] font-medium text-ink-muted" />
                {Array.from({ length: COLS }).map((_, col) => (
                  <th
                    key={col}
                    className={clsx(
                      'sticky top-0 z-20 h-7 min-w-[92px] border border-line bg-sunken px-1 text-[10px] font-medium',
                      selection.col === col ? 'text-brand-700 dark:text-brand-300' : 'text-ink-muted'
                    )}
                  >
                    {columnLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, row) => (
                <tr key={row}>
                  <th
                    className={clsx(
                      'sticky left-0 z-10 h-6 border border-line bg-sunken px-1 text-[10px] font-medium',
                      selection.row === row ? 'text-brand-700 dark:text-brand-300' : 'text-ink-muted'
                    )}
                  >
                    {row + 1}
                  </th>
                  {Array.from({ length: COLS }).map((_, col) => {
                    const key = cellId(col, row);
                    const result = results[key];
                    const style = sheet?.styles[key] ?? {};
                    const isSelected = selection.row === row && selection.col === col;
                    const isEditing = editCell?.row === row && editCell?.col === col;
                    return (
                      <td
                        key={key}
                        onClick={() => {
                          setSelection({ row, col });
                          setEditCell(null);
                          gridRef.current?.focus();
                        }}
                        onDoubleClick={() => startEdit(row, col)}
                        className={clsx(
                          'h-6 border border-line px-1 align-middle',
                          isSelected && 'ring-2 ring-inset ring-brand-500'
                        )}
                        style={{
                          background: style.bg,
                          textAlign: style.align ?? (typeof result?.value === 'number' ? 'right' : 'left'),
                        }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={() => commitEdit('none')}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitEdit('down');
                              } else if (event.key === 'Tab') {
                                event.preventDefault();
                                commitEdit('right');
                              } else if (event.key === 'Escape') {
                                setEditCell(null);
                                setDraft('');
                              }
                            }}
                            className={clsx(
                              'w-full bg-transparent font-mono text-[11.5px] text-ink outline-none',
                              style.b && 'font-semibold',
                              style.i && 'italic'
                            )}
                          />
                        ) : (
                          <div
                            className={clsx(
                              'h-[18px] truncate leading-[18px]',
                              style.b && 'font-semibold',
                              style.i && 'italic',
                              result?.error && 'text-rose-600',
                              typeof result?.value === 'number' && 'tabular-nums'
                            )}
                          >
                            {displayValue(result)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line bg-raised px-2 py-1.5">
        {book.map((item, index) => (
          <button
            key={item.id}
            onClick={() => {
              setActive(index);
              setSelection({ row: 0, col: 0 });
              setEditCell(null);
            }}
            className={clsx(
              'rounded-md px-2.5 py-1 text-[11.5px] font-medium transition',
              index === active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'text-ink-soft hover:bg-sunken'
            )}
          >
            {item.name}
          </button>
        ))}
        <button onClick={addSheet} className="icon-btn h-6 w-6" title="Add sheet">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex items-center gap-2 text-[10.5px] text-ink-muted">
          <button className="hover:text-ink" onClick={() => setRows((r) => r + 20)}>
            +20 rows
          </button>
          <span>·</span>
          <span>Formulas: SUM, IF, VLOOKUP, INDEX/MATCH, COUNTIF…</span>
        </div>
      </div>
    </div>
  );
}
