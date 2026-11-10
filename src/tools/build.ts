import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';

import type { TextPage } from './pdf-utils';

export interface DocSection {
  heading?: string;
  body?: string;
  bullets?: string[];
}

export interface DeckSlide {
  title: string;
  bullets: string[];
  notes?: string;
  image?: string;
}

export interface Deck {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
}

export async function docxFromTextPages(baseName: string, pages: TextPage[], lineMode = false): Promise<ArrayBuffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: baseName, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Converted from PDF by Office Suite — ${pages.length} page${pages.length === 1 ? '' : 's'}.`,
          italics: true,
          size: 18,
          color: '64748B',
        }),
      ],
      spacing: { after: 240 },
    }),
  ];

  pages.forEach((page, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const line of page.lines) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line.text, size: Math.round(line.size * 2) })],
          spacing: { after: lineMode ? 0 : 70 },
        })
      );
    }
  });

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return (await Packer.toBlob(doc)).arrayBuffer();
}

export async function docxFromSections(title: string, sections: DocSection[], subtitle?: string): Promise<ArrayBuffer> {
  const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  if (subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: subtitle, italics: true, color: '64748B', size: 20 })],
        spacing: { after: 240 },
      })
    );
  }
  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
        })
      );
    }
    if (section.body) {
      for (const block of section.body.split(/\n{2,}/)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.trim(), size: 22 })],
            spacing: { after: 120 },
          })
        );
      }
    }
    for (const bullet of section.bullets ?? []) {
      children.push(
        new Paragraph({
          text: bullet,
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
    }
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return (await Packer.toBlob(doc)).arrayBuffer();
}

export async function docxFromText(title: string, body: string): Promise<ArrayBuffer> {
  return docxFromSections(title, [{ body }]);
}

function addSlideChrome(pptx: PptxGenJS, slide: any, indexLabel: string, accent: string) {
  slide.background = { color: 'FFFFFF' } as any;
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.09, fill: { color: accent } });
  slide.addText(indexLabel, {
    x: 9.15,
    y: 5.14,
    w: 0.55,
    h: 0.3,
    fontSize: 9,
    color: '94A3B8',
    align: 'right',
  });
}

export async function pptxFromDeck(deck: Deck, accent = '2563EB'): Promise<ArrayBuffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Office Suite';
  pptx.company = 'Office Suite';
  pptx.title = deck.title;

  const cover = pptx.addSlide();
  (cover as any).background = { color: '0B1220' };
  cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.0, w: 1.1, h: 0.08, fill: { color: accent } });
  cover.addText(deck.title, {
    x: 0.6,
    y: 2.2,
    w: 8.8,
    h: 1.7,
    fontSize: 34,
    bold: true,
    color: 'F8FAFC',
    valign: 'top',
  });
  if (deck.subtitle) {
    cover.addText(deck.subtitle, { x: 0.62, y: 3.95, w: 8.6, h: 0.9, fontSize: 14, color: '94A3B8' });
  }
  cover.addText('Generated with Office Suite', {
    x: 0.62,
    y: 5.0,
    w: 6,
    h: 0.3,
    fontSize: 9,
    color: '64748B',
  });

  deck.slides.forEach((slideData, index) => {
    const slide = pptx.addSlide();
    addSlideChrome(pptx, slide, `${index + 2}`, accent);
    if (slideData.image) {
      slide.addImage({ data: slideData.image, x: 5.4, y: 1.2, w: 4.1, h: 3.6 });
      slide.addText(slideData.title, {
        x: 0.55,
        y: 0.42,
        w: 4.6,
        h: 1.6,
        fontSize: 24,
        bold: true,
        color: '0F172A',
        valign: 'top',
      });
      slide.addText(
        slideData.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.55, y: 2.15, w: 4.6, h: 2.9, fontSize: 12, color: '334155', valign: 'top', lineSpacingMultiple: 1.15 }
      );
    } else {
      slide.addText(slideData.title, {
        x: 0.55,
        y: 0.42,
        w: 8.9,
        h: 1.0,
        fontSize: 24,
        bold: true,
        color: '0F172A',
        valign: 'top',
      });
      slide.addText(
        slideData.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: 1.62, w: 8.8, h: 3.4, fontSize: 13, color: '334155', valign: 'top', lineSpacingMultiple: 1.2 }
      );
    }
    if (slideData.notes) slide.addNotes(slideData.notes);
  });

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as unknown as ArrayBuffer;
  return out;
}

export async function pptxFromTextPages(pages: TextPage[]): Promise<ArrayBuffer> {
  const deck: Deck = {
    title: 'PDF to PowerPoint',
    subtitle: `${pages.length} page${pages.length === 1 ? '' : 's'} converted by Office Suite`,
    slides: pages.map((page) => {
      const first = page.lines[0]?.text ?? `Page ${page.pageNumber}`;
      const title = first.length <= 90 ? first : `Page ${page.pageNumber}`;
      const rest = page.lines.slice(first.length <= 90 ? 1 : 0).map((l) => l.text);
      return {
        title,
        bullets: rest.length ? rest.slice(0, 9) : ['No selectable text on this page.'],
        notes: `Source PDF page ${page.pageNumber}`,
      };
    }),
  };
  return pptxFromDeck(deck);
}

function splitRow(text: string, mode: string): string[] {
  if (mode === 'tabs') return text.split('\t').map((s) => s.trim());
  if (mode === 'spaces') return text.split(/\s{2,}/).map((s) => s.trim());
  return text.split(/\t|\s{2,}/).map((s) => s.trim());
}

export function xlsxFromTextPages(pages: TextPage[], mode = 'auto'): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  pages.forEach((page) => {
    const rows = page.lines.map((line) => splitRow(line.text, mode));
    const width = Math.max(1, ...rows.map((r) => r.length));
    const padded = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
    const sheet = XLSX.utils.aoa_to_sheet(padded);
    sheet['!cols'] = Array.from({ length: width }, (_, i) => ({
      wch: Math.min(60, Math.max(10, ...rows.map((r) => (r[i] ?? '').length + 2))),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, `Page ${page.pageNumber}`.slice(0, 31));
  });
  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

export function csvFromRows(rows: (string | number)[][]): ArrayBuffer {
  const text = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(',')
    )
    .join('\r\n');
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export async function shaLikeHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice(0));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
