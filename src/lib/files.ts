import type { FileKind } from './db';

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
  enc: 'application/octet-stream',
};

export function uid(prefix = 'f'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function extOf(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function mimeOf(name: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXT[extOf(name)] ?? fallback;
}

export function kindOf(name: string, mime = ''): FileKind {
  const ext = extOf(name);
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['docx', 'doc', 'html', 'htm', 'txt', 'md'].includes(ext)) return 'writer';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (['pptx', 'ppt'].includes(ext)) return 'slides';
  return 'other';
}

export function bytesOfString(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export function textOfBytes(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToBlob(bytes: ArrayBuffer | Uint8Array, mime: string): Blob {
  const part = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Blob([part as unknown as BlobPart], { type: mime });
}

export function downloadBytes(bytes: ArrayBuffer | Uint8Array, name: string, mime = mimeOf(name)): void {
  const url = URL.createObjectURL(bytesToBlob(bytes, mime));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, name: string, mime = mimeOf(name)): void {
  downloadBytes(bytesOfString(text), name, mime);
}

export function humanSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function humanDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const diff = (now.getTime() - ts) / 86400000;
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function safeBaseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'document';
}

export function readFileBytes(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export async function dataUrlToBytes(dataUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl);
  return res.arrayBuffer();
}

export function bytesToDataUrl(bytes: ArrayBuffer, mime = 'application/pdf'): string {
  const blob = bytesToBlob(bytes, mime);
  return URL.createObjectURL(blob);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function plural(n: number, word: string, suffix = 's'): string {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

/** Strip characters that PDF base-14 fonts cannot encode (WinAnsi). */
export function latinOnly(text: string): string {
  const replacements: Record<string, string> = {
    '–': '-',
    '—': '-',
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '•': '-',
    '…': '...',
    '₹': 'Rs.',
    '×': 'x',
    '→': '->',
  };
  let out = '';
  for (const char of text) {
    if (replacements[char]) {
      out += replacements[char];
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 256) out += char;
    else if (code >= 0x0900 && code <= 0x097f) continue;
    else out += '?';
  }
  return out.trim();
}
