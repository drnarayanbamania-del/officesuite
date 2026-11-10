import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PDFDoc = pdfjs.PDFDocumentProxy;

export async function openPdf(bytes: ArrayBuffer): Promise<PDFDoc> {
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  } catch (error: any) {
    if (error?.name === 'PasswordException') {
      throw new Error('This PDF is password protected. Remove the password before processing it.');
    }
    throw new Error(`Could not read this PDF (${error?.message ?? 'unknown error'}).`);
  }
}

export async function openPdfLib(bytes: ArrayBuffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  } catch (error: any) {
    throw new Error(`Could not load this PDF (${error?.message ?? 'unknown error'}).`);
  }
}

export interface TextLine {
  text: string;
  size: number;
  x: number;
}

export interface TextPage {
  pageNumber: number;
  width: number;
  height: number;
  lines: TextLine[];
}

export function parsePageRange(input: string, total: number): number[] {
  const trimmed = (input ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>();
  for (const chunk of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const match = chunk.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 1;
      const end = match[2] ? Number(match[2]) : total;
      for (let p = Math.max(1, Math.min(start, end)); p <= Math.min(total, Math.max(start, end)); p++) {
        pages.add(p);
      }
      continue;
    }
    const single = Number(chunk);
    if (Number.isFinite(single) && single >= 1 && single <= total) pages.add(Math.floor(single));
  }
  const ordered = [...pages].sort((a, b) => a - b);
  return ordered.length ? ordered : Array.from({ length: total }, (_, i) => i + 1);
}

export async function extractTextPages(
  doc: PDFDoc,
  pages?: number[],
  onProgress?: (ratio: number) => void
): Promise<TextPage[]> {
  const targets = pages?.length ? pages : Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const result: TextPage[] = [];
  for (let i = 0; i < targets.length; i++) {
    const pageNumber = targets[i];
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const buckets: { y: number; size: number; parts: { x: number; end: number; text: string }[] }[] = [];

    for (const item of content.items as any[]) {
      const str: string = item?.str ?? '';
      if (!str.trim()) continue;
      const transform = item.transform as number[];
      const y = transform[5];
      const size = Math.abs(transform[3]) || Math.abs(transform[0]) || 11;
      const x = transform[4];
      const width = typeof item.width === 'number' ? item.width : size * str.length * 0.5;
      let bucket = buckets.find((b) => Math.abs(b.y - y) <= Math.max(2, size * 0.35));
      if (!bucket) {
        bucket = { y, size, parts: [] };
        buckets.push(bucket);
      }
      bucket.parts.push({ x, end: x + width, text: str });
    }

    const lines: TextLine[] = buckets
      .sort((a, b) => b.y - a.y)
      .map((bucket) => {
        const parts = bucket.parts.sort((a, b) => a.x - b.x);
        let text = '';
        let lastEnd: number | null = null;
        for (const part of parts) {
          if (lastEnd !== null && part.x - lastEnd > bucket.size * 0.28 && !text.endsWith(' ')) text += ' ';
          text += part.text;
          lastEnd = part.end;
        }
        return {
          text: text.replace(/\s+/g, ' ').trim(),
          size: Math.round(Math.min(48, Math.max(7, bucket.size)) * 10) / 10,
          x: parts[0]?.x ?? 0,
        };
      })
      .filter((line) => line.text.length > 0);

    result.push({ pageNumber, width: viewport.width, height: viewport.height, lines });
    page.cleanup();
    onProgress?.((i + 1) / targets.length);
  }
  return result;
}

export interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  jpeg?: Uint8Array;
}

export async function renderPages(
  doc: PDFDoc,
  pages: number[],
  scale: number,
  onProgress?: (ratio: number) => void
): Promise<RenderedPage[]> {
  const out: RenderedPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = await doc.getPage(pages[i]);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is not available in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas } as any).promise;
    out.push({
      pageNumber: pages[i],
      width: canvas.width,
      height: canvas.height,
      canvas,
    });
    page.cleanup();
    onProgress?.((i + 1) / pages.length);
  }
  return out;
}

export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality = 0.85
): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), type, quality);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function stitchCanvases(canvases: HTMLCanvasElement[], gap = 0): Promise<HTMLCanvasElement> {
  const width = Math.max(...canvases.map((c) => c.width));
  let height = canvases.reduce((sum, c) => sum + c.height, 0) + gap * Math.max(0, canvases.length - 1);
  const maxHeight = 30000;
  let scale = 1;
  if (height > maxHeight) scale = maxHeight / height;

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.floor(width * scale));
  out.height = Math.max(1, Math.floor(height * scale));
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const canvas of canvases) {
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    ctx.drawImage(canvas, 0, y, w, h);
    y += h + gap * scale;
  }
  return out;
}

function imageDataFromPdfImage(image: any): ImageData | null {
  const width = Math.floor(image?.width ?? 0);
  const height = Math.floor(image?.height ?? 0);
  const data = image?.data;
  if (!width || !height || !data) return null;
  if (typeof ImageData !== 'undefined' && data instanceof Uint8ClampedArray && image.kind !== 1) {
    try {
      return new ImageData(new Uint8ClampedArray(data), width, height);
    } catch {
      /* fall through to manual conversion */
    }
  }
  const out = new ImageData(width, height);
  if (image.kind === 1) {
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * stride + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const idx = (y * width + x) * 4;
        out.data[idx] = v;
        out.data[idx + 1] = v;
        out.data[idx + 2] = v;
        out.data[idx + 3] = 255;
      }
    }
    return out;
  }
  if (data.length >= width * height * 4) {
    for (let i = 0; i < width * height; i++) {
      out.data[i * 4] = data[i * 4];
      out.data[i * 4 + 1] = data[i * 4 + 1];
      out.data[i * 4 + 2] = data[i * 4 + 2];
      out.data[i * 4 + 3] = data[i * 4 + 3];
    }
    return out;
  }
  if (data.length >= width * height * 3) {
    for (let i = 0; i < width * height; i++) {
      out.data[i * 4] = data[i * 3];
      out.data[i * 4 + 1] = data[i * 3 + 1];
      out.data[i * 4 + 2] = data[i * 3 + 2];
      out.data[i * 4 + 3] = 255;
    }
    return out;
  }
  return null;
}

async function waitForImageObject(page: any, name: string): Promise<any | null> {
  try {
    const direct = page.objs.get(name);
    if (direct) return direct;
  } catch {
    /* not resolved yet */
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: any) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      page.objs.get(name, finish);
    } catch {
      finish(null);
    }
    setTimeout(() => finish(null), 1200);
  });
}

export interface ExtractedImage {
  pageNumber: number;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export async function extractEmbeddedImages(
  doc: PDFDoc,
  pages: number[],
  minWidth: number,
  onProgress?: (ratio: number) => void
): Promise<ExtractedImage[]> {
  const found: ExtractedImage[] = [];
  const seen = new Set<string>();
  const OPS = pdfjs.OPS as unknown as Record<string, number>;

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = pages[i];
    const page = await doc.getPage(pageNumber);
    try {
      const opList = await page.getOperatorList();
      for (let op = 0; op < opList.fnArray.length; op++) {
        const fn = opList.fnArray[op];
        if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject) continue;
        const name = opList.argsArray[op]?.[0];
        if (typeof name !== 'string' || seen.has(`${pageNumber}:${name}`)) continue;
        seen.add(`${pageNumber}:${name}`);
        const image = await waitForImageObject(page, name);
        if (!image) continue;
        if (image.bitmap) {
          const canvas = document.createElement('canvas');
          canvas.width = image.bitmap.width;
          canvas.height = image.bitmap.height;
          canvas.getContext('2d')!.drawImage(image.bitmap, 0, 0);
          if (canvas.width < minWidth) continue;
          found.push({
            pageNumber,
            width: canvas.width,
            height: canvas.height,
            bytes: await canvasToBytes(canvas, 'image/png'),
          });
          continue;
        }
        if ((image.width ?? 0) < minWidth) continue;
        const data = imageDataFromPdfImage(image);
        if (!data) continue;
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        canvas.getContext('2d')!.putImageData(data, 0, 0);
        found.push({
          pageNumber,
          width: canvas.width,
          height: canvas.height,
          bytes: await canvasToBytes(canvas, 'image/png'),
        });
      }
    } catch (error) {
      console.warn('Image extraction skipped a page', error);
    }
    page.cleanup();
    onProgress?.((i + 1) / pages.length);
  }
  return found;
}

export function pagesToMarkdown(pages: TextPage[]): string {
  return pages
    .map((page) => `## Page ${page.pageNumber}\n\n${page.lines.map((l) => l.text).join('\n')}`)
    .join('\n\n---\n\n');
}

export function pagesToPlainText(pages: TextPage[]): string {
  return pages
    .map((page) => page.lines.map((l) => l.text).join('\n'))
    .join('\n\n');
}

export async function imageBytesToCanvas(bytes: ArrayBuffer, mime: string): Promise<HTMLCanvasElement> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This image could not be decoded.'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
