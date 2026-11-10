export function printHtml(html: string, title: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    throw new Error('Printing is blocked by this browser.');
  }

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    html, body { background: #fff; color: #111827; }
    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 11.5pt; line-height: 1.55; }
    h1 { font-size: 21pt; margin: 0 0 12pt; }
    h2 { font-size: 16pt; margin: 16pt 0 8pt; }
    h3 { font-size: 13pt; margin: 14pt 0 6pt; }
    p { margin: 0 0 8pt; }
    ul, ol { margin: 0 0 9pt; padding-left: 20pt; }
    table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
    td, th { border: 1px solid #cbd5e1; padding: 5pt 8pt; font-size: 10.5pt; }
    img { max-width: 100%; }
    blockquote { border-left: 3px solid #cbd5e1; margin: 8pt 0; padding-left: 12pt; color: #475569; }
    a { color: #1d4ed8; }
  </style></head><body>${html}</body></html>`);
  doc.close();

  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 4000);
    }
  }, 350);
}
