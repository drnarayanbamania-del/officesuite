import JSZip from 'jszip';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';

import type { AIConfig } from '../lib/ai';
import { encryptBytes, decryptBytes } from '../lib/crypto';
import { humanSize, mimeOf, safeBaseName, stripExt, textOfBytes, extOf } from '../lib/files';
import {
  canvasToBytes,
  extractEmbeddedImages,
  extractTextPages,
  imageBytesToCanvas,
  openPdf,
  openPdfLib,
  pagesToMarkdown,
  pagesToPlainText,
  parsePageRange,
  renderPages,
  stitchCanvases,
  type TextPage,
} from './pdf-utils';
import {
  csvFromRows,
  docxFromSections,
  docxFromTextPages,
  pptxFromDeck,
  pptxFromTextPages,
  xlsxFromTextPages,
} from './build';
import {
  bundleToSections,
  buildMindmap,
  learn,
  translateText,
  type Flashcard,
  type LearnBundle,
  type QuizItem,
} from './learn';

export interface OutputFile {
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  label?: string;
}

export interface RunData {
  flashcards?: Flashcard[];
  quiz?: QuizItem[];
  summary?: string;
  bullets?: string[];
  text?: string;
  mindmapSvg?: string;
  info?: Record<string, string | number>;
  usedAI?: boolean;
  notes?: string[];
}

export interface RunResult {
  outputs: OutputFile[];
  notes: string[];
  data?: RunData;
  summary?: string;
}

export interface SourceFile {
  name: string;
  bytes: ArrayBuffer;
}

export interface RunContext {
  toolId: string;
  files: SourceFile[];
  options: Record<string, string | number | boolean>;
  ai: AIConfig | null;
  onProgress: (ratio: number, label?: string) => void;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const str = (ctx: RunContext, key: string, fallback = ''): string => {
  const value = ctx.options[key];
  return value === undefined || value === null ? fallback : String(value);
};
const num = (ctx: RunContext, key: string, fallback = 0): number => {
  const value = Number(ctx.options[key]);
  return Number.isFinite(value) ? value : fallback;
};
const bool = (ctx: RunContext, key: string): boolean =>
  ctx.options[key] === true || ctx.options[key] === 'true' || ctx.options[key] === 1;

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function scaleFor(quality: string): number {
  if (quality === 'high') return 2.2;
  if (quality === 'compact') return 1.1;
  return 1.6;
}

async function readPdfText(
  file: SourceFile,
  pages: string,
  onProgress?: (ratio: number) => void
): Promise<{ pages: TextPage[]; total: number }> {
  const doc = await openPdf(file.bytes);
  const selected = parsePageRange(pages, doc.numPages);
  try {
    const textPages = await extractTextPages(doc, selected, onProgress);
    return { pages: textPages, total: doc.numPages };
  } finally {
    doc.destroy().catch(() => undefined);
  }
}

export async function textFromFile(file: SourceFile): Promise<string> {
  const ext = extOf(file.name);
  if (ext === 'pdf') {
    const doc = await openPdf(file.bytes);
    const pages = await extractTextPages(doc);
    const text = pagesToPlainText(pages);
    doc.destroy().catch(() => undefined);
    if (!text.trim()) {
      throw new Error(
        'No text layer was found. This looks like a scanned PDF — OCR is not enabled in this build, so only embedded images or page renders are available.'
      );
    }
    return text;
  }
  if (ext === 'docx') {
    const module: any = await import('mammoth/mammoth.browser');
    const mammoth = module.default ?? module;
    const result = await mammoth.extractRawText({ arrayBuffer: file.bytes });
    return result.value;
  }
  return textOfBytes(file.bytes);
}

function latinOnly(text: string): string {
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

async function rasterizePdf(
  bytes: ArrayBuffer,
  scale: number,
  quality: number,
  pages: string,
  onProgress: (ratio: number) => void
): Promise<ArrayBuffer> {
  const doc = await openPdf(bytes);
  const selected = parsePageRange(pages, doc.numPages);
  const rendered = await renderPages(doc, selected, scale, (r) => onProgress(r * 0.85));
  doc.destroy().catch(() => undefined);
  const out = await PDFDocument.create();
  for (const page of rendered) {
    const jpg = await canvasToBytes(page.canvas, 'image/jpeg', quality);
    const image = await out.embedJpg(jpg);
    const width = page.canvas.width / scale;
    const height = page.canvas.height / scale;
    const pdfPage = out.addPage([width, height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width, height });
  }
  out.setProducer('Office Suite');
  out.setCreator('Office Suite');
  onProgress(1);
  return toArrayBuffer(await out.save());
}

async function zipFiles(entries: { name: string; bytes: ArrayBuffer }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.name, entry.bytes);
  return (await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })) as ArrayBuffer;
}

function outlineToDeck(bundle: LearnBundle, subtitle?: string) {
  return {
    title: bundle.deck.title || bundle.title,
    subtitle: subtitle ?? bundle.deck.subtitle,
    slides: bundle.deck.slides.map((slide) => ({
      title: slide.title,
      bullets: slide.bullets,
      notes: slide.notes,
    })),
  };
}

export async function runTool(ctx: RunContext): Promise<RunResult> {
  const file = ctx.files[0];
  const base = safeBaseName(stripExt(file?.name ?? 'document'));
  const notes: string[] = [];
  const progress = ctx.onProgress;

  switch (ctx.toolId) {
    /* ---------------------------------------------------------------- convert */
    case 'pdf-to-word': {
      progress(0.05, 'Reading the PDF text layer');
      const { pages, total } = await readPdfText(file, str(ctx, 'pages'), (p) => progress(0.05 + p * 0.65));
      if (!pages.some((p) => p.lines.length)) {
        throw new Error('This PDF has no text layer. Use “Export images by page” or an OCR pass instead.');
      }
      progress(0.8, 'Building the Word document');
      const bytes = await docxFromTextPages(base, pages, str(ctx, 'layout') === 'lines');
      progress(1);
      notes.push(`Rebuilt ${pages.length} of ${total} page${total === 1 ? '' : 's'} as an editable DOCX.`);
      notes.push('Text, font sizes and page breaks carry over; vector graphics and exact positioning do not.');
      return { outputs: [{ name: `${base}.docx`, mime: DOCX_MIME, bytes, label: 'Word document' }], notes };
    }

    case 'pdf-to-ppt': {
      progress(0.05, 'Reading pages');
      const { pages, total } = await readPdfText(file, str(ctx, 'pages'), (p) => progress(0.05 + p * 0.6));
      let deckImages: string[] = [];
      if (bool(ctx, 'includeImages')) {
        progress(0.7, 'Rendering page images');
        const doc = await openPdf(file.bytes);
        const rendered = await renderPages(doc, pages.map((p) => p.pageNumber), 1.1);
        deckImages = await Promise.all(
          rendered.map(async (r) => {
            const jpg = await canvasToBytes(r.canvas, 'image/jpeg', 0.8);
            let binary = '';
            jpg.forEach((b) => {
              binary += String.fromCharCode(b);
            });
            return `data:image/jpeg;base64,${btoa(binary)}`;
          })
        );
        doc.destroy().catch(() => undefined);
      }
      progress(0.85, 'Writing slides');
      let bytes: ArrayBuffer;
      if (deckImages.length) {
        bytes = await pptxFromDeck({
          title: base,
          subtitle: `${pages.length} pages converted from PDF`,
          slides: pages.map((page, i) => ({
            title: page.lines[0]?.text.slice(0, 90) ?? `Page ${page.pageNumber}`,
            bullets: page.lines.slice(1, 8).map((l) => l.text),
            image: deckImages[i],
          })),
        });
      } else {
        bytes = await pptxFromTextPages(pages);
      }
      progress(1);
      notes.push(`Created ${pages.length} slide${pages.length === 1 ? '' : 's'} from ${total} PDF page${total === 1 ? '' : 's'}.`);
      if (!pages.some((p) => p.lines.length)) notes.push('Pages without a text layer became empty slides.');
      return { outputs: [{ name: `${base}.pptx`, mime: PPTX_MIME, bytes, label: 'PowerPoint deck' }], notes };
    }

    case 'pdf-to-excel': {
      progress(0.05, 'Reading tables');
      const { pages } = await readPdfText(file, str(ctx, 'pages'), (p) => progress(0.05 + p * 0.7));
      progress(0.8, 'Writing the workbook');
      const bytes = xlsxFromTextPages(pages, str(ctx, 'split', 'auto'));
      progress(1);
      const rows = pages.reduce((sum, p) => sum + p.lines.length, 0);
      notes.push(`Mapped ${rows} text rows across ${pages.length} sheet${pages.length === 1 ? '' : 's'}.`);
      notes.push('Columns come from whitespace gaps between text runs; inspect wide tables before relying on them.');
      return { outputs: [{ name: `${base}.xlsx`, mime: XLSX_MIME, bytes, label: 'Excel workbook' }], notes };
    }

    case 'long-image': {
      progress(0.05, 'Rendering pages');
      const doc = await openPdf(file.bytes);
      const selected = parsePageRange(str(ctx, 'pages'), doc.numPages);
      const scale = scaleFor(str(ctx, 'quality', 'balanced'));
      const rendered = await renderPages(doc, selected, scale, (r) => progress(0.05 + r * 0.8));
      doc.destroy().catch(() => undefined);
      const stitched = await stitchCanvases(rendered.map((r) => r.canvas), 8);
      progress(0.92, 'Encoding PNG');
      const bytes = await canvasToBytes(stitched, 'image/png');
      progress(1);
      notes.push(`Stitched ${rendered.length} page${rendered.length === 1 ? '' : 's'} into a ${stitched.width}×${stitched.height}px PNG.`);
      return {
        outputs: [
          {
            name: `${base}-long.png`,
            mime: 'image/png',
            bytes: toArrayBuffer(bytes),
            label: 'Long image',
          },
        ],
        notes,
      };
    }

    case 'images-by-page': {
      progress(0.05, 'Rendering pages');
      const doc = await openPdf(file.bytes);
      const selected = parsePageRange(str(ctx, 'pages'), doc.numPages);
      const scale = scaleFor(str(ctx, 'quality', 'balanced'));
      const rendered = await renderPages(doc, selected, scale, (r) => progress(0.05 + r * 0.7));
      doc.destroy().catch(() => undefined);
      const format = str(ctx, 'format', 'png') === 'jpg' ? 'image/jpeg' : 'image/png';
      const entries: { name: string; bytes: ArrayBuffer }[] = [];
      for (let i = 0; i < rendered.length; i++) {
        const data = await canvasToBytes(rendered[i].canvas, format, 0.9);
        entries.push({
          name: `${base}-page-${String(rendered[i].pageNumber).padStart(2, '0')}.${format === 'image/png' ? 'png' : 'jpg'}`,
          bytes: toArrayBuffer(data),
        });
        progress(0.75 + ((i + 1) / rendered.length) * 0.15);
      }
      progress(0.95, 'Zipping');
      const bytes = await zipFiles(entries);
      progress(1);
      notes.push(`Exported ${entries.length} page image${entries.length === 1 ? '' : 's'}.`);
      return {
        outputs: [{ name: `${base}-images.zip`, mime: 'application/zip', bytes, label: 'Image archive' }],
        notes,
      };
    }

    case 'image-based-pdf': {
      progress(0.05, 'Rasterising pages');
      const bytes = await rasterizePdf(
        file.bytes,
        scaleFor(str(ctx, 'quality', 'balanced')),
        0.82,
        str(ctx, 'pages'),
        (p) => progress(0.05 + p * 0.9)
      );
      progress(1);
      notes.push('Each page is now a single image. Text is no longer selectable, but the layout is fixed.');
      notes.push(`Output size: ${humanSize(bytes.byteLength)} (was ${humanSize(file.bytes.byteLength)}).`);
      return {
        outputs: [{ name: `${base}-flattened.pdf`, mime: 'application/pdf', bytes, label: 'Image-based PDF' }],
        notes,
      };
    }

    case 'image-to-pdf': {
      const pageSize = str(ctx, 'pageSize', 'fit');
      const margin = num(ctx, 'margin', 0);
      const out = await PDFDocument.create();
      for (let i = 0; i < ctx.files.length; i++) {
        const imageFile = ctx.files[i];
        progress((i + 1) / (ctx.files.length + 1), `Adding ${imageFile.name}`);
        const canvas = await imageBytesToCanvas(imageFile.bytes, mimeOf(imageFile.name, 'image/png'));
        const png = toArrayBuffer(await canvasToBytes(canvas, 'image/png'));
        const embedded = await out.embedPng(png);
        if (pageSize === 'fit') {
          const width = (canvas.width * 72) / 96 + margin * 2;
          const height = (canvas.height * 72) / 96 + margin * 2;
          const page = out.addPage([Math.max(24, width), Math.max(24, height)]);
          page.drawImage(embedded, {
            x: margin,
            y: margin,
            width: width - margin * 2,
            height: height - margin * 2,
          });
        } else {
          const [pw, ph] = pageSize === 'letter' ? [612, 792] : [595.28, 841.89];
          const page = out.addPage([pw, ph]);
          const maxW = pw - margin * 2;
          const maxH = ph - margin * 2;
          const ratio = Math.min(maxW / embedded.width, maxH / embedded.height);
          const w = embedded.width * ratio;
          const h = embedded.height * ratio;
          page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
      }
      out.setProducer('Office Suite');
      progress(0.97, 'Saving PDF');
      const bytes = toArrayBuffer(await out.save());
      progress(1);
      return {
        outputs: [{ name: `${base || 'images'}.pdf`, mime: 'application/pdf', bytes, label: 'PDF' }],
        notes: [`Combined ${ctx.files.length} image${ctx.files.length === 1 ? '' : 's'} into one PDF.`],
      };
    }

    case 'extract-images': {
      progress(0.05, 'Scanning embedded images');
      const doc = await openPdf(file.bytes);
      const selected = parsePageRange(str(ctx, 'pages'), doc.numPages);
      const images = await extractEmbeddedImages(doc, selected, num(ctx, 'minSize', 64), (r) =>
        progress(0.05 + r * 0.8)
      );
      doc.destroy().catch(() => undefined);
      if (!images.length) {
        return {
          outputs: [],
          notes: [
            'No embedded raster images were found on these pages. Vector art and page scans are not image objects — use “Export images by page” to rasterise them instead.',
          ],
        };
      }
      progress(0.9, 'Packaging');
      const entries = images.map((image, index) => ({
        name: `page-${String(image.pageNumber).padStart(2, '0')}-image-${index + 1}-${image.width}x${image.height}.png`,
        bytes: toArrayBuffer(image.bytes),
      }));
      const bytes = await zipFiles(entries);
      progress(1);
      notes.push(`Recovered ${entries.length} embedded image${entries.length === 1 ? '' : 's'} from ${selected.length} page${selected.length === 1 ? '' : 's'}.`);
      return {
        outputs: [{ name: `${base}-images.zip`, mime: 'application/zip', bytes, label: 'Image archive' }],
        notes,
      };
    }

    case 'extract-text': {
      progress(0.05, 'Reading text');
      const { pages } = await readPdfText(file, str(ctx, 'pages'), (p) => progress(0.05 + p * 0.85));
      const format = str(ctx, 'format', 'md');
      const text = format === 'md' ? pagesToMarkdown(pages) : pagesToPlainText(pages);
      if (!text.trim()) throw new Error('No text could be extracted. This PDF probably has no text layer (a scan).');
      progress(0.95);
      const words = text.split(/\s+/).filter(Boolean).length;
      notes.push(`${words} words across ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
      return {
        outputs: [
          {
            name: `${base}.${format === 'md' ? 'md' : 'txt'}`,
            mime: format === 'md' ? 'text/markdown' : 'text/plain',
            bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
            label: 'Extracted text',
          },
        ],
        notes,
        data: { text: text.slice(0, 20000) },
      };
    }

    case 'extract-pages': {
      const source = await openPdfLib(file.bytes);
      const total = source.getPageCount();
      const selected = parsePageRange(str(ctx, 'pages'), total);
      if (str(ctx, 'separate')) {
        const entries: { name: string; bytes: ArrayBuffer }[] = [];
        for (const pageNumber of selected) {
          const out = await PDFDocument.create();
          const [copied] = await out.copyPages(source, [pageNumber - 1]);
          out.addPage(copied);
          entries.push({
            name: `${base}-page-${String(pageNumber).padStart(2, '0')}.pdf`,
            bytes: toArrayBuffer(await out.save()),
          });
          progress(pageNumber / total);
        }
        const bytes = await zipFiles(entries);
        return {
          outputs: [{ name: `${base}-pages.zip`, mime: 'application/zip', bytes, label: 'Page archive' }],
          notes: [`Extracted ${entries.length} page${entries.length === 1 ? '' : 's'} into separate PDFs.`],
        };
      }
      const out = await PDFDocument.create();
      const copied = await out.copyPages(source, selected.map((p) => p - 1));
      copied.forEach((page) => out.addPage(page));
      const bytes = toArrayBuffer(await out.save());
      progress(1);
      return {
        outputs: [{ name: `${base}-extract.pdf`, mime: 'application/pdf', bytes, label: 'Extracted pages' }],
        notes: [`Copied ${selected.length} page${selected.length === 1 ? '' : 's'} from a ${total}-page PDF.`],
      };
    }

    /* ---------------------------------------------------------------- process */
    case 'merge-documents': {
      if (ctx.files.length < 2) throw new Error('Select at least two PDFs to merge.');
      const merged = await PDFDocument.create();
      let totalPages = 0;
      for (let i = 0; i < ctx.files.length; i++) {
        const loaded = await openPdfLib(ctx.files[i].bytes);
        const pages = await merged.copyPages(loaded, loaded.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
        totalPages += pages.length;
        progress((i + 1) / ctx.files.length);
        notes.push(`${ctx.files[i].name} — ${pages.length} page${pages.length === 1 ? '' : 's'}`);
      }
      const bytes = toArrayBuffer(await merged.save());
      return {
        outputs: [{ name: `merged-${ctx.files.length}-documents.pdf`, mime: 'application/pdf', bytes, label: 'Merged PDF' }],
        notes,
        summary: `${totalPages} pages from ${ctx.files.length} files`,
      };
    }

    case 'split-pdf': {
      const source = await openPdfLib(file.bytes);
      const total = source.getPageCount();
      const mode = str(ctx, 'mode', 'ranges');
      const groups: { label: string; pages: number[] }[] = [];
      if (mode === 'each') {
        for (let p = 1; p <= total; p++) groups.push({ label: `page-${String(p).padStart(2, '0')}`, pages: [p] });
      } else if (mode === 'every') {
        const size = Math.max(1, Math.floor(num(ctx, 'size', 2)));
        for (let start = 1; start <= total; start += size) {
          const pages = Array.from({ length: Math.min(size, total - start + 1) }, (_, i) => start + i);
          groups.push({ label: `pages-${pages[0]}-${pages[pages.length - 1]}`, pages });
        }
      } else {
        const ranges = str(ctx, 'ranges', '1-1, 2-').split(',').map((s) => s.trim()).filter(Boolean);
        for (const range of ranges) {
          const pages = parsePageRange(range, total);
          groups.push({ label: `pages-${pages[0]}-${pages[pages.length - 1]}`, pages });
        }
      }
      if (!groups.length) throw new Error('No page ranges were recognised.');
      const entries: { name: string; bytes: ArrayBuffer }[] = [];
      for (let i = 0; i < groups.length; i++) {
        const out = await PDFDocument.create();
        const copied = await out.copyPages(source, groups[i].pages.map((p) => p - 1));
        copied.forEach((page) => out.addPage(page));
        entries.push({ name: `${base}-${groups[i].label}.pdf`, bytes: toArrayBuffer(await out.save()) });
        progress((i + 1) / groups.length);
      }
      const zip = groups.length === 1 ? entries[0] : { name: `${base}-split.zip`, bytes: await zipFiles(entries) };
      return {
        outputs: [
          {
            name: zip.name,
            mime: zip.name.endsWith('.zip') ? 'application/zip' : 'application/pdf',
            bytes: zip.bytes,
            label: 'Split output',
          },
        ],
        notes: [`Produced ${groups.length} file${groups.length === 1 ? '' : 's'} from ${total} page${total === 1 ? '' : 's'}.`],
      };
    }

    case 'compress-pdf': {
      const level = str(ctx, 'level', 'balanced');
      const presets: Record<string, [number, number]> = {
        strong: [0.9, 0.52],
        balanced: [1.4, 0.7],
        light: [2.0, 0.84],
      };
      const [scale, quality] = presets[level] ?? presets.balanced;
      progress(0.05, 'Re-encoding pages');
      const bytes = await rasterizePdf(file.bytes, scale, quality, str(ctx, 'pages'), (p) => progress(0.05 + p * 0.9));
      progress(1);
      if (bytes.byteLength >= file.bytes.byteLength) {
        return {
          outputs: [
            {
              name: file.name,
              mime: 'application/pdf',
              bytes: file.bytes,
              label: 'Original (already smaller)',
            },
          ],
          notes: [
            `Compression would have produced ${humanSize(bytes.byteLength)}, larger than the original ${humanSize(file.bytes.byteLength)}.`,
            'This PDF is mostly text or vector content; re-encoding it adds weight. The original has been kept.',
          ],
        };
      }
      const saved = 1 - bytes.byteLength / file.bytes.byteLength;
      notes.push(`Reduced ${humanSize(file.bytes.byteLength)} → ${humanSize(bytes.byteLength)} (${Math.round(saved * 100)}% smaller).`);
      notes.push('Pages are now images, so text is no longer selectable in the compressed file.');
      return {
        outputs: [{ name: `${base}-compressed.pdf`, mime: 'application/pdf', bytes, label: 'Compressed PDF' }],
        notes,
        summary: `${Math.round(saved * 100)}% smaller`,
      };
    }

    case 'reduce-size': {
      const targetBytes = Math.max(0.05, num(ctx, 'target', 2)) * 1024 * 1024;
      const presets: [number, number][] = [
        [1.6, 0.72],
        [1.25, 0.62],
        [0.95, 0.5],
        [0.72, 0.4],
      ];
      let best: ArrayBuffer = file.bytes;
      for (let i = 0; i < presets.length; i++) {
        const [scale, quality] = presets[i];
        progress((i / presets.length) * 0.9, `Attempt ${i + 1} of ${presets.length}`);
        const attempt = await rasterizePdf(file.bytes, scale, quality, str(ctx, 'pages'), () => undefined);
        if (attempt.byteLength < best.byteLength) best = attempt;
        if (attempt.byteLength <= targetBytes) break;
      }
      progress(1);
      if (best.byteLength >= file.bytes.byteLength) {
        return {
          outputs: [{ name: file.name, mime: 'application/pdf', bytes: file.bytes, label: 'Original' }],
          notes: [
            `Could not beat the original size of ${humanSize(file.bytes.byteLength)} without destroying quality.`,
            'The original file has been kept.',
          ],
        };
      }
      const metTarget = best.byteLength <= targetBytes;
      notes.push(`Result: ${humanSize(best.byteLength)}${metTarget ? ' — target met' : ' — target not reached at usable quality'}.`);
      notes.push('Pages were rasterised to reach this size; text is no longer selectable.');
      return {
        outputs: [{ name: `${base}-reduced.pdf`, mime: 'application/pdf', bytes: best, label: 'Reduced PDF' }],
        notes,
      };
    }

    case 'translate': {
      progress(0.05, 'Reading source text');
      const text = await textFromFile(file);
      progress(0.15, `Translating to ${str(ctx, 'target', 'Hindi')}`);
      const translated = await translateText(text, str(ctx, 'target', 'Hindi'), ctx.ai, (r) =>
        progress(0.15 + r * 0.7)
      );
      progress(0.9, 'Building the document');
      const bilingual = bool(ctx, 'bilingual');
      const sections = bilingual
        ? [
            { heading: `Translated — ${str(ctx, 'target', 'Hindi')}`, body: translated },
            { heading: 'Original text', body: text.slice(0, 12000) },
          ]
        : [{ heading: `Translated — ${str(ctx, 'target', 'Hindi')}`, body: translated }];
      const bytes = await docxFromSections(`${base} — ${str(ctx, 'target', 'Hindi')}`, sections);
      progress(1);
      notes.push(`Translated ${text.split(/\s+/).filter(Boolean).length} words into ${str(ctx, 'target', 'Hindi')}.`);
      return {
        outputs: [
          { name: `${base}-${str(ctx, 'target', 'Hindi').toLowerCase().replace(/\s+/g, '-')}.docx`, mime: DOCX_MIME, bytes, label: 'Translated DOCX' },
          {
            name: `${base}-translation.txt`,
            mime: 'text/plain',
            bytes: new TextEncoder().encode(translated).buffer as ArrayBuffer,
            label: 'Translated text',
          },
        ],
        notes,
        data: { text: translated.slice(0, 20000) },
      };
    }

    /* ------------------------------------------------------------------ learn */
    case 'summarize':
    case 'learning-assistant':
    case 'flashcards':
    case 'quiz':
    case 'learning-content':
    case 'generate-questions': {
      progress(0.05, 'Reading the document');
      let pages: TextPage[] | undefined;
      let text: string;
      if (extOf(file.name) === 'pdf') {
        const doc = await openPdf(file.bytes);
        const selected = parsePageRange(str(ctx, 'pages'), doc.numPages);
        pages = await extractTextPages(doc, selected, (p) => progress(0.05 + p * 0.4));
        text = pagesToPlainText(pages);
        doc.destroy().catch(() => undefined);
      } else {
        text = await textFromFile(file);
      }
      if (text.trim().length < 120) throw new Error('There is not enough text in this file to analyse.');
      progress(0.5, ctx.ai?.apiKey ? 'Asking the study assistant' : 'Running the offline study engine');

      const kind =
        ctx.toolId === 'summarize'
          ? 'summary'
          : ctx.toolId === 'flashcards'
          ? 'flashcards'
          : ctx.toolId === 'quiz'
          ? 'quiz'
          : ctx.toolId === 'learning-content'
          ? 'lesson'
          : ctx.toolId === 'generate-questions'
          ? 'questions'
          : 'guide';

      const depthMap: Record<string, string> = { short: 'quick', medium: 'standard', long: 'deep' };
      const bundle = await learn(kind, text, ctx.ai, {
        count:
          ctx.toolId === 'flashcards'
            ? num(ctx, 'count', 12)
            : ctx.toolId === 'quiz'
            ? num(ctx, 'count', 10)
            : num(ctx, 'count', 12),
        depth: (ctx.toolId === 'learning-assistant' ? str(ctx, 'depth', 'standard') : depthMap[str(ctx, 'length', 'medium')]) ?? 'standard',
        level: str(ctx, 'level', 'intermediate'),
        pages: pages?.map((p) => ({ pageNumber: p.pageNumber, lines: p.lines.map((l) => ({ text: l.text })) })),
      });
      progress(0.85, 'Formatting results');

      notes.push(...bundle.notes);
      if (bundle.usedAI) notes.push('Generated with your configured AI provider.');
      else notes.push('Generated locally from the document text — no data left this device.');

      const outputs: OutputFile[] = [];
      const title =
        ctx.toolId === 'summarize'
          ? `${base} — summary`
          : ctx.toolId === 'flashcards'
          ? `${base} — flashcards`
          : ctx.toolId === 'quiz'
          ? `${base} — quiz`
          : ctx.toolId === 'learning-content'
          ? `${base} — lesson`
          : ctx.toolId === 'generate-questions'
          ? `${base} — questions`
          : `${base} — study brief`;

      if (ctx.toolId === 'flashcards') {
        const rows: string[][] = [['Front', 'Back'], ...bundle.flashcards.map((c) => [c.front, c.back])];
        outputs.push({
          name: `${base}-flashcards.csv`,
          mime: 'text/csv',
          bytes: csvFromRows(rows),
          label: 'Flashcards (CSV)',
        });
        notes.push(`${bundle.flashcards.length} cards. Import the CSV into Anki or Quizlet.`);
      } else {
        const sections = bundleToSections(bundle, kind);
        const bytes = await docxFromSections(title, sections);
        outputs.push({
          name: `${base}-${ctx.toolId}.docx`,
          mime: DOCX_MIME,
          bytes,
          label: 'Study document',
        });
      }
      progress(1);
      return {
        outputs,
        notes,
        summary: bundle.summary.slice(0, 400),
        data: {
          flashcards: bundle.flashcards,
          quiz: bundle.quiz,
          summary: bundle.summary,
          bullets: bundle.bullets,
          usedAI: bundle.usedAI,
          notes: bundle.notes,
        },
      };
    }

    case 'ai-presentation': {
      progress(0.05, 'Reading the source');
      let pages: TextPage[] | undefined;
      let text: string;
      if (extOf(file.name) === 'pdf') {
        const doc = await openPdf(file.bytes);
        pages = await extractTextPages(doc, undefined, (p) => progress(0.05 + p * 0.35));
        text = pagesToPlainText(pages);
        doc.destroy().catch(() => undefined);
      } else {
        text = await textFromFile(file);
      }
      if (text.trim().length < 150) throw new Error('Not enough source text to build a deck.');
      progress(0.5, ctx.ai?.apiKey ? 'Designing the deck' : 'Outlining the deck locally');
      const bundle = await learn('deck', text, ctx.ai, {
        slideCount: num(ctx, 'slides', 8),
        pages: pages?.map((p) => ({ pageNumber: p.pageNumber, lines: p.lines.map((l) => ({ text: l.text })) })),
      });
      progress(0.8, 'Writing the PowerPoint file');
      const bytes = await pptxFromDeck(outlineToDeck(bundle, `${bundle.deck.slides.length} slides • ${str(ctx, 'tone', 'professional')}`));
      progress(1);
      notes.push(...bundle.notes);
      notes.push(`Created a ${bundle.deck.slides.length}-slide deck. Edit it in Slides or PowerPoint.`);
      return {
        outputs: [{ name: `${base}-presentation.pptx`, mime: PPTX_MIME, bytes, label: 'Presentation' }],
        notes,
        data: { notes: bundle.notes, usedAI: bundle.usedAI },
      };
    }

    case 'mind-map': {
      progress(0.05, 'Reading the source');
      const text = await textFromFile(file);
      if (text.trim().length < 120) throw new Error('Not enough text to map.');
      progress(0.45, ctx.ai?.apiKey ? 'Structuring the map' : 'Finding key ideas locally');
      const bundle = await learn('mindmap', text, ctx.ai, {
        branchCount: num(ctx, 'branches', 6),
        details: bool(ctx, 'details'),
      });
      const { mindmapToSvg } = await import('./learn');
      const svg = mindmapToSvg(bundle.mindmap);
      progress(0.95, 'Rendering SVG');
      return {
        outputs: [
          {
            name: `${base}-mindmap.svg`,
            mime: 'image/svg+xml',
            bytes: new TextEncoder().encode(svg).buffer as ArrayBuffer,
            label: 'Mind map (SVG)',
          },
        ],
        notes: [...bundle.notes, `${bundle.mindmap.branches.length} branches from ${bundle.mindmap.root}.`],
        data: { mindmapSvg: svg, usedAI: bundle.usedAI },
      };
    }

    /* --------------------------------------------------------------- annotate */
    case 'pdf-watermark': {
      const text = latinOnly(str(ctx, 'text', 'CONFIDENTIAL'));
      if (!text) throw new Error('The watermark text is empty or contains only unsupported characters.');
      const doc = await openPdfLib(file.bytes);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const selected = parsePageRange(str(ctx, 'page'), doc.getPageCount());
      const opacity = Math.min(1, Math.max(0.02, num(ctx, 'opacity', 0.18)));
      const angle = num(ctx, 'rotation', 45);
      const size = Math.min(160, Math.max(8, num(ctx, 'size', 60)));
      doc.getPages().forEach((page, index) => {
        if (!selected.includes(index + 1)) return;
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(text, size);
        const x = Math.max(12, (width - textWidth * Math.cos((angle * Math.PI) / 180)) / 2);
        const y = height / 2 - size / 2;
        page.drawText(text, {
          x,
          y,
          size,
          font,
          color: rgb(0.39, 0.45, 0.55),
          opacity,
          rotate: degrees(angle),
        });
      });
      doc.setProducer('Office Suite');
      progress(0.9);
      const bytes = toArrayBuffer(await doc.save());
      progress(1);
      if (str(ctx, 'text').trim() !== text) notes.push('Non-Latin characters were skipped because PDF base fonts only cover Latin text.');
      return {
        outputs: [{ name: `${base}-watermarked.pdf`, mime: 'application/pdf', bytes, label: 'Watermarked PDF' }],
        notes,
      };
    }

    case 'pdf-signature': {
      const signer = latinOnly(str(ctx, 'signer'));
      if (!signer) throw new Error('Enter the signer’s name (Latin characters only).');
      const doc = await openPdfLib(file.bytes);
      const font = await doc.embedFont(StandardFonts.TimesRomanItalic);
      const pageCount = doc.getPageCount();
      const pageIndex = Math.min(pageCount, Math.max(1, Math.floor(num(ctx, 'page', 1)))) - 1;
      const page = doc.getPage(pageIndex);
      const { width, height } = page.getSize();
      const size = Math.min(60, Math.max(8, num(ctx, 'size', 22)));
      const textWidth = font.widthOfTextAtSize(signer, size);
      const position = str(ctx, 'position', 'bottom-right');
      const x = position === 'bottom-left' ? 56 : position === 'bottom-center' ? (width - textWidth) / 2 : width - textWidth - 56;
      const y = 64;
      page.drawLine({
        start: { x: x - 4, y: y - 6 },
        end: { x: x + textWidth + 4, y: y - 6 },
        thickness: 0.7,
        color: rgb(0.4, 0.45, 0.55),
      });
      page.drawText(signer, { x, y, size, font, color: rgb(0.07, 0.09, 0.15) });
      page.drawText('Signed with Office Suite', {
        x,
        y: y - 16,
        size: 7,
        font: await doc.embedFont(StandardFonts.Helvetica),
        color: rgb(0.55, 0.6, 0.68),
      });
      doc.setProducer('Office Suite');
      const bytes = toArrayBuffer(await doc.save());
      progress(1);
      notes.push(`Signed page ${pageIndex + 1} of ${pageCount}. This is a visual signature, not a cryptographic certificate.`);
      return {
        outputs: [{ name: `${base}-signed.pdf`, mime: 'application/pdf', bytes, label: 'Signed PDF' }],
        notes,
      };
    }

    /* ----------------------------------------------------------------- manage */
    case 'encrypt-document': {
      const password = str(ctx, 'password');
      const bytes = await encryptBytes(file.bytes, password);
      progress(1);
      return {
        outputs: [
          {
            name: `${file.name}.enc`,
            mime: 'application/octet-stream',
            bytes,
            label: 'Encrypted container',
          },
        ],
        notes: [
          'AES-256-GCM with a PBKDF2-derived key (210,000 iterations).',
          'This is a Office Suite container, not a PDF-standard password — open it here with “Decrypt document”.',
          str(ctx, 'hint') ? `Hint stored in plain text: ${str(ctx, 'hint')}` : 'No password hint stored.',
        ],
      };
    }

    case 'decrypt-document': {
      const bytes = await decryptBytes(file.bytes, str(ctx, 'password'));
      const decoded = new Uint8Array(bytes.slice(0, 5));
      const isPdf = String.fromCharCode(...decoded) === '%PDF-';
      const name = file.name.replace(/\.enc$/i, '') || `${base}.pdf`;
      progress(1);
      return {
        outputs: [
          {
            name,
            mime: isPdf ? 'application/pdf' : mimeOf(name),
            bytes,
            label: 'Decrypted file',
          },
        ],
        notes: ['Decrypted successfully. The password is never stored.'],
      };
    }

    case 'document-info': {
      const doc = await openPdfLib(file.bytes);
      const info = {
        pages: doc.getPageCount(),
        title: doc.getTitle() ?? '—',
        author: doc.getAuthor() ?? '—',
        subject: doc.getSubject() ?? '—',
        creator: doc.getCreator() ?? '—',
        producer: doc.getProducer() ?? '—',
        created: doc.getCreationDate()?.toISOString() ?? '—',
        modified: doc.getModificationDate()?.toISOString() ?? '—',
        size: humanSize(file.bytes.byteLength),
      };
      const report = new TextEncoder().encode(JSON.stringify(info, null, 2)).buffer as ArrayBuffer;
      const outputs: OutputFile[] = [
        { name: `${base}-info.json`, mime: 'application/json', bytes: report, label: 'Metadata report' },
      ];
      if (bool(ctx, 'apply')) {
        if (str(ctx, 'title')) doc.setTitle(str(ctx, 'title'));
        if (str(ctx, 'author')) doc.setAuthor(str(ctx, 'author'));
        if (str(ctx, 'subject')) doc.setSubject(str(ctx, 'subject'));
        doc.setModificationDate(new Date());
        const bytes = toArrayBuffer(await doc.save());
        outputs.unshift({ name: `${base}-updated.pdf`, mime: 'application/pdf', bytes, label: 'Updated PDF' });
        notes.push('Metadata written into the PDF.');
      } else {
        notes.push('Tick “Write these values into the PDF” to save changes.');
      }
      progress(1);
      return {
        outputs,
        notes,
        data: { info: info as unknown as Record<string, string | number> },
      };
    }

    case 'file-properties': {
      const doc = await openPdfLib(file.bytes);
      const pdfjsDoc = await openPdf(file.bytes);
      const sizes = doc.getPages().map((page, index) => {
        const { width, height } = page.getSize();
        return `Page ${index + 1}: ${Math.round(width)} × ${Math.round(height)} pt`;
      });
      const info: Record<string, string | number> = {
        File: file.name,
        'File size': humanSize(file.bytes.byteLength),
        Pages: pdfjsDoc.numPages,
        'PDF producer': doc.getProducer() ?? '—',
        'PDF version': (pdfjsDoc as any)._pdfInfo?.PDFFormatVersion ?? '—',
        Encrypted: (pdfjsDoc as any)._pdfInfo?.IsEncrypted ? 'Yes' : 'No',
        'First page size': sizes[0] ?? '—',
      };
      const xlsxReport = XLSX.utils.aoa_to_sheet([['Property', 'Value'], ...Object.entries(info)]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, xlsxReport, 'Properties');
      const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      pdfjsDoc.destroy().catch(() => undefined);
      progress(1);
      return {
        outputs: [{ name: `${base}-properties.xlsx`, mime: XLSX_MIME, bytes, label: 'Properties report' }],
        notes: [`${pdfjsDoc.numPages} page${pdfjsDoc.numPages === 1 ? '' : 's'}; ${sizes.length} page size entries read.`],
        data: { info },
      };
    }

    default:
      throw new Error('This tool has no processor yet.');
  }
}

export function defaultOutputNames(toolId: string): string[] {
  switch (toolId) {
    case 'pdf-to-word':
      return ['docx'];
    case 'pdf-to-ppt':
      return ['pptx'];
    case 'pdf-to-excel':
      return ['xlsx'];
    default:
      return ['pdf'];
  }
}
