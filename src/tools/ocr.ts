import Fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { createWorker } from 'tesseract.js';

import latinFontUrl from '../assets/fonts/NotoSans-Regular.ttf?url';
import devaFontUrl from '../assets/fonts/NotoSansDevanagari-Regular.ttf?url';
import { safeBaseName, stripExt } from '../lib/files';
import { docxFromSections } from './build';
import { openPdf, parsePageRange, renderPages, type PDFDoc } from './pdf-utils';

const DEVANAGARI = /[\u0900-\u097F]/;

export type OcrLanguage = 'eng' | 'hin' | 'eng+hin';

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  words: OcrWord[];
  confidence: number;
  widthPt: number;
  heightPt: number;
  skew: number;
  preview: string;
}

export interface OcrOutput {
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  label: string;
}

export interface OcrResult {
  pages: OcrPageResult[];
  outputs: OcrOutput[];
  averageConfidence: number;
  totalPages: number;
  processedPages: number;
  elapsedMs: number;
  notes: string[];
}

export interface DetectResult {
  totalPages: number;
  sampledPages: number;
  pagesWithText: number;
  characters: number;
  likelyScanned: boolean;
}

export interface OcrOptions {
  languages: OcrLanguage;
  pages?: string;
  dpi?: number;
  enhance?: boolean;
  deskew?: boolean;
}

export interface OcrRunOptions {
  onProgress?: (info: { ratio: number; label: string }) => void;
  signal?: AbortSignal;
}

const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function assertPdf(bytes: ArrayBuffer): void {
  const head = new Uint8Array(bytes.slice(0, 5));
  const magic = String.fromCharCode(...head);
  if (magic !== '%PDF-') throw new Error('That file is not a PDF. Choose a PDF document to recognize.');
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Recognition cancelled', 'AbortError');
}

/** Inspect up to five pages to decide whether the document has a usable text layer. */
export async function detectScannedPdf(bytes: ArrayBuffer, sampleLimit = 5): Promise<DetectResult> {
  assertPdf(bytes);
  const doc = await openPdf(bytes);
  try {
    const totalPages = doc.numPages;
    const sampledPages = Math.min(totalPages, sampleLimit);
    let characters = 0;
    let pagesWithText = 0;
    for (let pageNumber = 1; pageNumber <= sampledPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items as any[])
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      characters += text.length;
      if (text.length >= 24) pagesWithText++;
      page.cleanup();
    }
    const likelyScanned =
      pagesWithText === 0 || (pagesWithText < Math.ceil(sampledPages / 2) && characters < 80 * sampledPages);
    return { totalPages, sampledPages, pagesWithText, characters, likelyScanned };
  } finally {
    doc.destroy().catch(() => undefined);
  }
}

/** Grayscale, contrast-stretch and remove isolated specks from a rendered page. */
function enhanceCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const count = canvas.width * canvas.height;
  const gray = new Uint8Array(count);
  const histogram = new Uint32Array(256);

  for (let pixel = 0, offset = 0; offset < data.length; offset += 4, pixel++) {
    const value = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) | 0;
    gray[pixel] = value;
    histogram[value]++;
  }

  let low = 0;
  let high = 255;
  let accumulated = 0;
  const lowTarget = count * 0.02;
  const highTarget = count * 0.98;
  for (let value = 0; value < 256; value++) {
    accumulated += histogram[value];
    if (accumulated >= lowTarget) {
      low = value;
      break;
    }
  }
  accumulated = 0;
  for (let value = 0; value < 256; value++) {
    accumulated += histogram[value];
    if (accumulated >= highTarget) {
      high = value;
      break;
    }
  }
  // A clean white page has almost no pixels under the 2nd percentile, so the
  // span is tiny. Stretching that would invert the page; only stretch genuine
  // low-contrast scans.
  const span = high - low;
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    lut[value] =
      span < 40 ? value : Math.max(0, Math.min(255, Math.round(((value - low) * 255) / span)));
  }

  const width = canvas.width;
  const height = canvas.height;
  const stretched = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel++) stretched[pixel] = lut[gray[pixel]];

  // Remove only fully isolated dark specks. Glyph strokes always touch another
  // dark pixel, so this cannot eat thin anti-aliased text.
  const cleaned = new Uint8Array(stretched);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      if (stretched[index] > 100) continue;
      let bright = 0;
      if (stretched[index - width - 1] > 165) bright++;
      if (stretched[index - width] > 165) bright++;
      if (stretched[index - width + 1] > 165) bright++;
      if (stretched[index - 1] > 165) bright++;
      if (stretched[index + 1] > 165) bright++;
      if (stretched[index + width - 1] > 165) bright++;
      if (stretched[index + width] > 165) bright++;
      if (stretched[index + width + 1] > 165) bright++;
      if (bright === 8) cleaned[index] = 255;
    }
  }

  for (let pixel = 0, offset = 0; offset < data.length; offset += 4, pixel++) {
    const value = cleaned[pixel];
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function rotateCanvas(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, output.width, output.height);
  context.translate(output.width / 2, output.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}

/**
 * Estimate page skew in degrees with a horizontal projection profile.
 * Returns 0 when the page is already level.
 */
function estimateSkew(canvas: HTMLCanvasElement): number {
  const maxWidth = 480;
  const scale = Math.min(1, maxWidth / canvas.width);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.floor(canvas.width * scale));
  small.height = Math.max(1, Math.floor(canvas.height * scale));
  const context = small.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, small.width, small.height);
  const { data } = context.getImageData(0, 0, small.width, small.height);

  const inkPoints: { x: number; y: number }[] = [];
  const stride = Math.max(1, Math.floor((small.width * small.height) / 120000));
  for (let pixel = 0; pixel < small.width * small.height; pixel += stride) {
    const offset = pixel * 4;
    const luma = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) | 0;
    if (luma < 135) {
      inkPoints.push({ x: pixel % small.width, y: Math.floor(pixel / small.width) });
    }
  }
  if (inkPoints.length < 200) return 0;

  const centreX = small.width / 2;
  const rowOffset = small.height;
  let bestAngle = 0;
  let bestScore = -Infinity;

  for (let angle = -6; angle <= 6; angle += 0.5) {
    const slope = Math.tan((angle * Math.PI) / 180);
    const rows = new Uint32Array(small.height * 3);
    for (const point of inkPoints) {
      const row = Math.round(point.y + slope * (point.x - centreX)) + rowOffset;
      if (row >= 0 && row < rows.length) rows[row]++;
    }
    let score = 0;
    for (let index = 0; index < rows.length; index++) {
      const value = rows[index];
      if (value) score += value * value;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return Math.abs(bestAngle) < 0.6 ? 0 : bestAngle;
}

interface ParsedText {
  words: OcrWord[];
  text: string;
  lineOf: number[];
  averageConfidence: number;
}

/** Parse Tesseract's TSV output into word boxes and readable lines. */
function parseTsv(tsv: string, fallbackText: string, width: number, height: number): ParsedText {
  const lines = new Map<string, { y: number; words: { x: number; text: string }[] }>();
  const words: OcrWord[] = [];
  const lineOf: number[] = [];
  const lineIndexByKey = new Map<string, number>();
  let confidenceTotal = 0;
  let confidenceCount = 0;

  const rows = (tsv || '').split(/\r?\n/);
  for (let row = 1; row < rows.length; row++) {
    const columns = rows[row].split('\t');
    if (columns.length < 12) continue;
    if (columns[0] !== '5') continue;
    const text = columns.slice(11).join('\t').trim();
    if (!text) continue;
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const boxWidth = Number(columns[8]);
    const boxHeight = Number(columns[9]);
    const confidence = Number(columns[10]);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;

    const word: OcrWord = {
      text,
      x: left / width,
      y: top / height,
      w: boxWidth / width,
      h: boxHeight / height,
      confidence: Number.isFinite(confidence) && confidence >= 0 ? confidence : 0,
    };
    words.push(word);
    if (word.confidence > 0) {
      confidenceTotal += word.confidence;
      confidenceCount++;
    }

    const key = `${columns[1]}-${columns[2]}-${columns[3]}-${columns[4]}`;
    if (!lineIndexByKey.has(key)) lineIndexByKey.set(key, lineIndexByKey.size);
    lineOf.push(lineIndexByKey.get(key)!);
    let line = lines.get(key);
    if (!line) {
      line = { y: word.y, words: [] };
      lines.set(key, line);
    }
    line.words.push({ x: word.x, text });
  }

  let text = [...lines.values()]
    .sort((a, b) => a.y - b.y)
    .map((line) =>
      line.words
        .sort((a, b) => a.x - b.x)
        .map((word) => word.text)
        .join(' ')
    )
    .join('\n')
    .trim();

  if (!text) text = (fallbackText || '').trim();
  return {
    words,
    text,
    lineOf,
    averageConfidence: confidenceCount ? confidenceTotal / confidenceCount : 0,
  };
}

function splitRuns(text: string): { text: string; deva: boolean }[] {
  const runs: { text: string; deva: boolean }[] = [];
  for (const char of text) {
    const deva = DEVANAGARI.test(char);
    const last = runs[runs.length - 1];
    if (last && last.deva === deva) last.text += char;
    else runs.push({ text: char, deva });
  }
  return runs;
}

let fontCache: { latin: ArrayBuffer; deva: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ latin: ArrayBuffer; deva: ArrayBuffer }> {
  if (fontCache) return fontCache;
  const [latin, deva] = await Promise.all([
    fetch(latinFontUrl).then((response) => {
      if (!response.ok) throw new Error('The Latin text-layer font is missing from the bundle.');
      return response.arrayBuffer();
    }),
    fetch(devaFontUrl).then((response) => {
      if (!response.ok) throw new Error('The Devanagari text-layer font is missing from the bundle.');
      return response.arrayBuffer();
    }),
  ]);
  fontCache = { latin, deva };
  return fontCache;
}

/**
 * Encode text by code point instead of fontkit's shaper. Invisible OCR text only
 * needs a faithful character-to-glyph mapping, and fontkit's Devanagari layout
 * throws on some mark combinations in this build. Direct mapping also keeps
 * ToUnicode in logical order, so search and copy return the recognized text.
 */
function disableFontShaping(pdfFont: any): void {
  const embedder = pdfFont?.embedder;
  const font = embedder?.font;
  if (!embedder || !font || typeof font.glyphForCodePoint !== 'function') return;
  let HexString: any;
  try {
    HexString = embedder.encodeText('A').constructor;
  } catch {
    return;
  }
  const subset = embedder.subset;

  embedder.encodeText = (text: string) => {
    const ids: string[] = [];
    for (const character of text) {
      const point = character.codePointAt(0);
      if (point === undefined) continue;
      const glyph = font.glyphForCodePoint(point);
      let id = glyph.id;
      if (subset) {
        id = subset.includeGlyph(glyph);
        embedder.glyphs[id - 1] = glyph;
        embedder.glyphIdMap.set(glyph.id, id);
        embedder.glyphCache?.invalidate?.();
      }
      ids.push(id.toString(16).padStart(4, '0'));
    }
    return HexString.of(ids.join(''));
  };

  embedder.widthOfTextAtSize = (text: string, size: number) => {
    let width = 0;
    for (const character of text) {
      const point = character.codePointAt(0);
      if (point !== undefined) {
        width += font.glyphForCodePoint(point).advanceWidth * embedder.scale;
      }
    }
    return (width * size) / 1000;
  };
}

let workerPromise: Promise<any> | null = null;
let workerLanguages = '';

async function getWorker(
  languages: OcrLanguage,
  logger: (message: { status: string; progress: number }) => void
): Promise<any> {
  if (workerPromise && workerLanguages === languages) return workerPromise;
  if (workerPromise) {
    try {
      const previous = await workerPromise;
      await previous.terminate();
    } catch {
      /* ignore */
    }
    workerPromise = null;
  }
  workerLanguages = languages;
  workerPromise = createWorker(languages, 1, {
    workerPath: `${window.location.origin}/ocr/worker.min.js`,
    corePath: `${window.location.origin}/ocr/core`,
    langPath: `${window.location.origin}/tessdata`,
    gzip: false,
    logger,
    errorHandler: (error: unknown) => console.warn('OCR worker error', error),
  } as any).catch((error: unknown) => {
    workerPromise = null;
    workerLanguages = '';
    throw new Error(
      `The OCR engine could not start (${error instanceof Error ? error.message : 'unknown error'}). Check that /ocr and /tessdata are being served, then try again.`
    );
  });
  return workerPromise;
}

export async function resetOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* ignore */
  }
  workerPromise = null;
  workerLanguages = '';
}

/** Run OCR over a PDF and build a searchable PDF, plain text and DOCX. */
export async function ocrPdf(
  file: { name: string; bytes: ArrayBuffer },
  options: OcrOptions,
  runOptions: OcrRunOptions = {}
): Promise<OcrResult> {
  const startedAt = Date.now();
  const { onProgress, signal } = runOptions;
  assertPdf(file.bytes);
  checkAborted(signal);

  const base = safeBaseName(stripExt(file.name)) || 'document';
  const report = (ratio: number, label: string) => onProgress?.({ ratio: Math.min(1, Math.max(0, ratio)), label });

  report(0.02, 'Reading the document');
  const source = await openPdf(file.bytes);
  const pageNumberList = parsePageRange(options.pages ?? '', source.numPages);
  const fonts = await loadFonts();
  checkAborted(signal);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(Fontkit as any);
  const latinFont = await pdf.embedFont(fonts.latin, { subset: true });
  const devaFont = await pdf.embedFont(fonts.deva, { subset: true });
  disableFontShaping(devaFont);
  pdf.setTitle(base);
  pdf.setCreator('Office Suite OCR');
  pdf.setProducer('Office Suite');

  const pages: OcrPageResult[] = [];
  const notes: string[] = [];
  const dpi = Math.min(320, Math.max(120, options.dpi ?? 200));

  let worker: any = null;
  let lastLogLabel = 'Starting OCR engine';
  const logger = (message: { status: string; progress: number }) => {
    if (!message?.status) return;
    lastLogLabel = message.status
      .replace(/_/g, ' ')
      .replace(/^\w/, (character) => character.toUpperCase());
  };

  try {
    report(0.04, 'Loading the OCR engine');
    worker = await getWorker(options.languages, logger);
    checkAborted(signal);

    for (let index = 0; index < pageNumberList.length; index++) {
      checkAborted(signal);
      const pageNumber = pageNumberList[index];
      const pageBase = index / pageNumberList.length;
      const pageSpan = 1 / pageNumberList.length;
      report(0.08 + pageBase * 0.82, `Page ${index + 1} of ${pageNumberList.length}: rendering`);

      const page = await source.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const widthPt = viewport.width;
      const heightPt = viewport.height;
      const renderScale = Math.min(dpi / 72, 2800 / Math.max(widthPt, heightPt));
      const rendered = await renderPages(source, [pageNumber], renderScale);
      page.cleanup();
      let canvas = rendered[0].canvas;

      if (options.enhance !== false) enhanceCanvas(canvas);

      let skew = 0;
      if (options.deskew !== false) {
        skew = estimateSkew(canvas);
        if (skew !== 0) {
          canvas = rotateCanvas(canvas, skew);
          notes.push(`Page ${pageNumber}: deskewed by ${Math.abs(skew).toFixed(1)}°.`);
        }
      }

      report(0.08 + pageBase * 0.82 + pageSpan * 0.12, `Page ${index + 1} of ${pageNumberList.length}: recognizing text`);
      checkAborted(signal);
      const recognition = await worker.recognize(canvas, {}, { text: true, tsv: true });
      checkAborted(signal);
      const data = recognition?.data ?? {};
      const parsed = parseTsv(String(data.tsv ?? ''), String(data.text ?? ''), canvas.width, canvas.height);
      const confidence =
        typeof data.confidence === 'number' && data.confidence > 0 ? data.confidence : parsed.averageConfidence;
      if (!parsed.text) notes.push(`Page ${pageNumber}: no text was recognized (low contrast or blank page).`);

      // Visual background: the processed page exactly as recognized.
      const jpeg = await canvasToJpeg(canvas, 0.88);
      const embedded = await pdf.embedJpg(jpeg);
      const pdfPage = pdf.addPage([widthPt, heightPt]);
      pdfPage.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });

      // Invisible text layer aligned with each recognized word.
      parsed.words.forEach((word, wordIndex) => {
        const runs = splitRuns(word.text + (isLineEnd(parsed.lineOf, wordIndex) ? '' : ' ')).filter(
          (run) => run.text.length > 0
        );
        if (!runs.length) return;
        const sizeFromHeight = (word.h * heightPt) / 1 * 0.9;
        let size = Math.max(1.5, Math.min(96, sizeFromHeight));
        const boxWidth = word.w * widthPt;
        const measure = (candidate: number) =>
          runs.reduce(
            (sum, run) => sum + (run.deva ? devaFont : latinFont).widthOfTextAtSize(run.text, candidate),
            0
          );
        let width = measure(size);
        if (boxWidth > 0 && width > boxWidth * 1.12) {
          size = Math.max(1, (size * boxWidth * 1.12) / width);
          width = measure(size);
        }
        if (!Number.isFinite(width) || width <= 0) return;

        let cursorX = word.x * widthPt;
        const baselineY = heightPt - (word.y + word.h) * heightPt + size * 0.16;
        for (const run of runs) {
          const font = run.deva ? devaFont : latinFont;
          try {
            pdfPage.drawText(run.text, {
              x: Math.max(-2, Math.min(widthPt, cursorX)),
              y: Math.max(-2, Math.min(heightPt, baselineY)),
              size,
              font,
              color: rgb(1, 1, 1),
              opacity: 0,
            });
            cursorX += font.widthOfTextAtSize(run.text, size);
          } catch (error) {
            console.warn('Could not place an OCR word in the text layer', error);
          }
        }
      });

      const preview = makePreview(canvas);
      pages.push({
        pageNumber,
        text: parsed.text,
        words: parsed.words,
        confidence: Math.round(confidence),
        widthPt: Math.round(widthPt),
        heightPt: Math.round(heightPt),
        skew: Number(skew.toFixed(1)),
        preview,
      });

      report(
        0.08 + pageBase * 0.82 + pageSpan * 0.9,
        `Page ${index + 1} of ${pageNumberList.length}: ${lastLogLabel.toLowerCase()}`
      );
    }

    report(0.92, 'Writing outputs');
    const pdfBytes = toArrayBuffer(await pdf.save());
    const textBody = pages
      .map((page) => `===== Page ${page.pageNumber} =====\n\n${page.text || '(no text recognized)'}`)
      .join('\n\n');
    const txtBytes = new TextEncoder().encode(`${base}\nRecognized with Office Suite OCR\n\n${textBody}\n`).buffer as ArrayBuffer;
    const docxBytes = await docxFromSections(
      `${base} — recognized text`,
      pages.map((page) => ({ heading: `Page ${page.pageNumber}`, body: page.text || '(No text recognized on this page.)' })),
      'OCR output. Review recognized text against the original before relying on it.'
    );

    const averageConfidence = pages.length
      ? Math.round(pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length)
      : 0;

    report(1, 'Recognition complete');
    notes.unshift(
      'Searchable PDF keeps the scanned page as an image and adds an invisible, word-positioned text layer.'
    );
    if (pages.some((page) => DEVANAGARI.test(page.text))) {
      notes.push('Devanagari text uses the bundled Noto Sans Devanagari font for the invisible text layer.');
    }

    return {
      pages,
      averageConfidence,
      totalPages: source.numPages,
      processedPages: pages.length,
      elapsedMs: Date.now() - startedAt,
      notes: Array.from(new Set(notes)),
      outputs: [
        { name: `${base}-searchable.pdf`, mime: MIME_PDF, bytes: pdfBytes, label: 'Searchable PDF' },
        { name: `${base}-ocr.txt`, mime: 'text/plain', bytes: txtBytes, label: 'Plain text' },
        { name: `${base}-ocr.docx`, mime: MIME_DOCX, bytes: docxBytes, label: 'Word document' },
      ],
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && /OCR engine|font|PDF/.test(error.message)) throw error;
    throw new Error(error instanceof Error ? error.message : 'Recognition failed unexpectedly.');
  } finally {
    source.destroy().catch(() => undefined);
    if (signal?.aborted) {
      // Terminate a worker that may still hold the cancelled page.
      resetOcrWorker().catch(() => undefined);
    }
  }
}

function isLineEnd(lineOf: number[], index: number): boolean {
  return index + 1 >= lineOf.length || lineOf[index] !== lineOf[index + 1];
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not encode the page image.'))), 'image/jpeg', quality);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function makePreview(canvas: HTMLCanvasElement): string {
  const maxWidth = 760;
  const scale = Math.min(1, maxWidth / canvas.width);
  const preview = document.createElement('canvas');
  preview.width = Math.max(1, Math.round(canvas.width * scale));
  preview.height = Math.max(1, Math.round(canvas.height * scale));
  const context = preview.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, preview.width, preview.height);
  context.drawImage(canvas, 0, 0, preview.width, preview.height);
  return preview.toDataURL('image/jpeg', 0.78);
}


function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
