import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import PdfViewer from './pages/PdfViewer';
import Presentation from './pages/Presentation';
import Spreadsheet from './pages/Spreadsheet';
import ToolPage from './pages/ToolPage';
import Writer from './pages/Writer';

const HOME_SEO = {
  title: 'Office Suite — Documents, Sheets, Slides & PDF',
  description:
    'Free local-first office suite for documents, spreadsheets, slides, PDF conversion and OCR. Edit, sign and export files without uploads or an account.',
};

const ROUTE_SEO: Record<string, { title: string; description: string }> = {
  '/': HOME_SEO,
  '/writer': {
    title: 'Free Document Editor — Office Suite',
    description:
      'Write and format documents in your browser. Import DOCX, export DOCX or PDF, and keep every file on your device — no uploads or account.',
  },
  '/sheet': {
    title: 'Free Spreadsheet Editor — Office Suite',
    description:
      'Build spreadsheets with formulas and formatting in your browser. Import XLSX or CSV and export clean files without uploading your data.',
  },
  '/slides': {
    title: 'Free Presentation Maker — Office Suite',
    description:
      'Create polished presentations in your browser. Import PPTX, edit slides and export to PowerPoint or PDF while your files stay on your device.',
  },
  '/pdf': {
    title: 'Free PDF Editor & Converter — Office Suite',
    description:
      'Open, annotate, merge, split, sign, convert and OCR PDFs locally in your browser. No uploads, no account and no server-side processing.',
  },
};

const TOOL_SEO = {
  title: 'Free PDF & Document Tools — Office Suite',
  description:
    'Browse free browser-based tools for PDF conversion, OCR, document editing, annotation and file management — all processed on your device.',
};

const EDITOR_PATHS = ['/writer', '/sheet', '/slides', '/pdf'];

function canonicalPath(pathname: string) {
  const editorPath = EDITOR_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (editorPath) return editorPath;
  return pathname.startsWith('/tools/') ? pathname : '/';
}

function setMeta(selector: string, content: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content);
}

function RouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const path = canonicalPath(pathname);
    const seo = ROUTE_SEO[path] ?? (path.startsWith('/tools/') ? TOOL_SEO : HOME_SEO);
    const canonicalUrl = `${window.location.origin}${path === '/' ? '/' : path}`;

    document.title = seo.title;
    setMeta('meta[name="description"]', seo.description);
    setMeta('meta[property="og:title"]', seo.title);
    setMeta('meta[property="og:description"]', seo.description);
    setMeta('meta[property="og:url"]', canonicalUrl);
    setMeta('meta[name="twitter:title"]', seo.title);
    setMeta('meta[name="twitter:description"]', seo.description);

    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = canonicalUrl;
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <RouteSeo />
      <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/writer" element={<Writer />} />
        <Route path="/writer/:id" element={<Writer />} />
        <Route path="/sheet" element={<Spreadsheet />} />
        <Route path="/sheet/:id" element={<Spreadsheet />} />
        <Route path="/slides" element={<Presentation />} />
        <Route path="/slides/:id" element={<Presentation />} />
        <Route path="/pdf" element={<PdfViewer />} />
        <Route path="/pdf/:id" element={<PdfViewer />} />
        <Route path="/tools/:toolId" element={<ToolPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
