import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
}

const PARAGRAPH_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'pre']);
const HEADING_LEVELS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

function styleFor(element: Element, inherited: RunStyle): RunStyle {
  const tag = element.tagName.toLowerCase();
  const style: RunStyle = { ...inherited };
  if (tag === 'strong' || tag === 'b') style.bold = true;
  if (tag === 'em' || tag === 'i') style.italics = true;
  if (tag === 'u' || tag === 'ins') style.underline = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') style.strike = true;
  const inline = (element as HTMLElement).style;
  if (inline?.fontWeight === 'bold' || Number(inline?.fontWeight) >= 600) style.bold = true;
  if (inline?.fontStyle === 'italic') style.italics = true;
  if (inline && /underline/.test(inline.textDecoration || inline.textDecorationLine || '')) style.underline = true;
  return style;
}

function makeRun(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    underline: style.underline ? {} : undefined,
    strike: style.strike,
    size: 22,
  });
}

async function imageRun(element: HTMLImageElement): Promise<ImageRun | null> {
  const src = element.getAttribute('src');
  if (!src) return null;
  try {
    const response = await fetch(src);
    const buffer = await response.arrayBuffer();
    const mime = response.headers.get('content-type') || 'image/png';
    const type = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('gif') ? 'gif' : 'png';
    const width = Number(element.getAttribute('width')) || element.naturalWidth || 480;
    const height = Number(element.getAttribute('height')) || element.naturalHeight || 320;
    const scale = Math.min(1, 520 / Math.max(width, 1));
    return new ImageRun({
      data: buffer,
      transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
      type: type as 'png' | 'jpg' | 'gif',
    });
  } catch {
    return null;
  }
}

async function inlineChildren(
  node: Node,
  inherited: RunStyle
): Promise<(TextRun | ImageRun)[]> {
  const runs: (TextRun | ImageRun)[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.replace(/\u00a0/g, ' ') ?? '';
      if (text) runs.push(makeRun(text, inherited));
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (tag === 'img') {
      const image = await imageRun(child as HTMLImageElement);
      if (image) runs.push(image);
      continue;
    }
    if (tag === 'script' || tag === 'style') continue;
    runs.push(...(await inlineChildren(child, styleFor(child, inherited))));
  }
  return runs;
}

function paragraphFromRuns(runs: (TextRun | ImageRun)[], options: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; style?: RunStyle } = {}) {
  return new Paragraph({
    children: runs,
    heading: options.heading,
    spacing: { after: 140 },
  });
}

async function tableFromElement(table: HTMLTableElement): Promise<Table> {
  const rows: TableRow[] = [];
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const cells: TableCell[] = [];
    for (const cell of Array.from(row.children)) {
      if (!['td', 'th'].includes(cell.tagName.toLowerCase())) continue;
      const runs = await inlineChildren(cell, { bold: cell.tagName.toLowerCase() === 'th' });
      cells.push(
        new TableCell({
          children: [new Paragraph({ children: runs.length ? runs : [new TextRun('')], spacing: { after: 0 } })],
          columnSpan: Number(cell.getAttribute('colspan')) || undefined,
        })
      );
    }
    if (cells.length) rows.push(new TableRow({ children: cells }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function blocksFrom(parent: Node): Promise<(Paragraph | Table)[]> {
  const blocks: (Paragraph | Table)[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) blocks.push(paragraphFromRuns([makeRun(text, {})]));
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();

    if (tag === 'script' || tag === 'style') continue;
    if (tag === 'table') {
      blocks.push(await tableFromElement(child as HTMLTableElement));
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      let index = 1;
      for (const item of Array.from(child.children)) {
        if (item.tagName.toLowerCase() !== 'li') continue;
        const runs = await inlineChildren(item, {});
        const prefix = tag === 'ol' ? `${index++}. ` : '•  ';
        blocks.push(
          new Paragraph({
            children: [makeRun(prefix, {}), ...runs],
            indent: { left: 360 },
            spacing: { after: 70 },
          })
        );
      }
      continue;
    }
    if (HEADING_LEVELS[tag]) {
      const runs = await inlineChildren(child, { bold: true });
      blocks.push(paragraphFromRuns(runs, { heading: HEADING_LEVELS[tag] }));
      continue;
    }
    if (PARAGRAPH_TAGS.has(tag)) {
      const runs = await inlineChildren(child, {});
      if (runs.length) blocks.push(paragraphFromRuns(runs));
      for (const nested of Array.from(child.children)) {
        const nestedTag = nested.tagName.toLowerCase();
        if (tag === 'div' && (PARAGRAPH_TAGS.has(nestedTag) || nestedTag === 'ul' || nestedTag === 'ol' || nestedTag === 'table' || HEADING_LEVELS[nestedTag])) {
          blocks.push(...(await blocksFrom(nested.parentElement === child ? nested : nested)));
        }
      }
      continue;
    }
    if (tag === 'blockquote') {
      const runs = await inlineChildren(child, { italics: true });
      blocks.push(
        new Paragraph({
          children: runs,
          indent: { left: 480 },
          spacing: { after: 160 },
        })
      );
      continue;
    }
    if (tag === 'hr') {
      blocks.push(new Paragraph({ text: '', border: { bottom: { style: 'single', size: 6, color: 'CBD5E1' } } }));
      continue;
    }
    const runs = await inlineChildren(child, {});
    if (runs.length) blocks.push(paragraphFromRuns(runs));
  }
  return blocks;
}

export async function htmlToDocx(html: string, title: string): Promise<ArrayBuffer> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 220 } }),
    ...(await blocksFrom(parsed.body)),
  ];
  if (!children.length) children.push(new Paragraph({ children: [new TextRun('')] }));
  const document = new Document({
    creator: 'Office Suite',
    title,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children,
      },
    ],
  });
  return (await Packer.toBlob(document)).arrayBuffer();
}

export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function docxToHtml(bytes: ArrayBuffer): Promise<string> {
  const mammothModule: any = await import('mammoth/mammoth.browser');
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return result.value || '<p></p>';
}

export const DOCX_MIME_TYPE = DOCX_MIME;
export const ALIGN = AlignmentType;
