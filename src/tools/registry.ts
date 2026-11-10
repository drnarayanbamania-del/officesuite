import {
  Brain,
  Combine,
  FileArchive,
  FileDown,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Files,
  FolderOpen,
  GraduationCap,
  Highlighter,
  History,
  Image,
  Images,
  Info,
  Languages,
  ListChecks,
  Lock,
  Map,
  Merge,
  MessageSquare,
  Minimize2,
  PenTool,
  Presentation,
  Scissors,
  Sparkles,
  Stamp,
  Trash2,
  Unlock,
  type LucideIcon,
} from 'lucide-react';

export type CategoryId = 'convert' | 'extract' | 'process' | 'learn' | 'annotate' | 'manage';

export interface ToolCategory {
  id: CategoryId;
  name: string;
  description: string;
  icon: LucideIcon;
  iconBg: string;
  iconText: string;
  dot: string;
}

export const CATEGORIES: ToolCategory[] = [
  {
    id: 'convert',
    name: 'Format conversion',
    description: 'Move content between PDF, Word, slides, spreadsheets and images.',
    icon: FileDown,
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    iconText: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  {
    id: 'extract',
    name: 'Extract PDF content',
    description: 'Pull text, embedded images and pages out of a document.',
    icon: FileSearch,
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
    iconText: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  {
    id: 'process',
    name: 'Process document',
    description: 'Merge, split, reorder, translate and shrink files.',
    icon: Scissors,
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    iconText: 'text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  {
    id: 'learn',
    name: 'Learning assistant',
    description: 'Turn source material into summaries, cards, quizzes and lessons.',
    icon: GraduationCap,
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    iconText: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  {
    id: 'annotate',
    name: 'Annotate PDF',
    description: 'Highlight, comment, stamp, sign and watermark documents.',
    icon: Highlighter,
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    iconText: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  {
    id: 'manage',
    name: 'Document management',
    description: 'History, encryption, properties and handing files to other apps.',
    icon: Files,
    iconBg: 'bg-slate-200 dark:bg-slate-500/15',
    iconText: 'text-slate-700 dark:text-slate-300',
    dot: 'bg-slate-500',
  },
];

export type ToolOption =
  | { key: string; label: string; type: 'text'; default: string; placeholder?: string; help?: string }
  | { key: string; label: string; type: 'textarea'; default: string; placeholder?: string; help?: string }
  | {
      key: string;
      label: string;
      type: 'number';
      default: number;
      min?: number;
      max?: number;
      step?: number;
      help?: string;
    }
  | {
      key: string;
      label: string;
      type: 'select';
      default: string;
      choices: { label: string; value: string }[];
      help?: string;
    }
  | { key: string; label: string; type: 'checkbox'; default: boolean; help?: string };

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  icon: LucideIcon;
  accept: string;
  multiple?: boolean;
  minFiles?: number;
  options?: ToolOption[];
  launch?: 'pdf-viewer' | 'versions' | 'organizer' | 'ocr';
  viewerMode?: 'view' | 'highlight' | 'comment' | 'stamp';
  ai?: boolean;
  outputNote?: string;
}

const pageOption = (defaultValue = '1-') => ({
  key: 'pages',
  label: 'Pages',
  type: 'text' as const,
  default: defaultValue,
  placeholder: '1-3, 5, 8-',
  help: 'Use ranges like 1-3 or leave blank for all pages.',
});

const qualityOption = {
  key: 'quality',
  label: 'Output quality',
  type: 'select' as const,
  default: 'balanced',
  choices: [
    { label: 'Compact — small file', value: 'compact' },
    { label: 'Balanced — recommended', value: 'balanced' },
    { label: 'High — print ready', value: 'high' },
  ],
};

export const TOOLS: ToolDef[] = [
  // ---------- Format conversion ----------
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    description: 'Rebuild an editable DOCX from the PDF text layer.',
    category: 'convert',
    icon: FileText,
    accept: '.pdf',
    options: [
      { key: 'layout', label: 'Paragraph handling', type: 'select', default: 'auto', choices: [
        { label: 'Auto — detect paragraphs', value: 'auto' },
        { label: 'Keep every line separate', value: 'lines' },
      ] },
      pageOption(),
    ],
    outputNote: 'Text, sizes and page breaks are preserved. Complex vector art and exact kerning are not.',
  },
  {
    id: 'pdf-to-ppt',
    name: 'PDF to PowerPoint',
    description: 'Turn each PDF page into a slide with its text intact.',
    category: 'convert',
    icon: Presentation,
    accept: '.pdf',
    options: [
      pageOption(),
      { key: 'includeImages', label: 'Place page image behind text', type: 'checkbox', default: false, help: 'Keeps the original look but makes slides heavier.' },
    ],
    outputNote: 'One slide per PDF page; text is placed as slide text so it stays editable.',
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    description: 'Map each page’s rows and columns into a spreadsheet.',
    category: 'convert',
    icon: FileSpreadsheet,
    accept: '.pdf',
    options: [
      pageOption(),
      { key: 'split', label: 'Column separator', type: 'select', default: 'auto', choices: [
        { label: 'Auto — detect gaps', value: 'auto' },
        { label: 'Two or more spaces', value: 'spaces' },
        { label: 'Tab characters only', value: 'tabs' },
      ] },
    ],
    outputNote: 'Works best on tabular PDFs. Scanned pages have no text layer to convert.',
  },
  {
    id: 'long-image',
    name: 'Export as long image',
    description: 'Stitch every page into one tall PNG for sharing.',
    category: 'convert',
    icon: Images,
    accept: '.pdf',
    options: [
      qualityOption,
      pageOption(),
      { key: 'background', label: 'Page background', type: 'select', default: 'white', choices: [
        { label: 'White', value: 'white' },
        { label: 'Transparent gaps', value: 'transparent' },
      ] },
    ],
  },
  {
    id: 'images-by-page',
    name: 'Export images by page',
    description: 'Render pages to PNG or JPG files in a ZIP.',
    category: 'convert',
    icon: Image,
    accept: '.pdf',
    options: [
      { key: 'format', label: 'Format', type: 'select', default: 'png', choices: [
        { label: 'PNG — crisp text', value: 'png' },
        { label: 'JPG — smaller', value: 'jpg' },
      ] },
      qualityOption,
      pageOption(),
    ],
  },
  {
    id: 'image-based-pdf',
    name: 'Export as image-based PDF',
    description: 'Flatten pages into images so the layout can’t reflow.',
    category: 'convert',
    icon: FileArchive,
    accept: '.pdf',
    options: [qualityOption, pageOption()],
    outputNote: 'Text becomes non-selectable; use this to lock visual layout.',
  },
  {
    id: 'image-to-pdf',
    name: 'Image to PDF',
    description: 'Combine photos and scans into a single PDF.',
    category: 'convert',
    icon: Images,
    accept: 'image/*',
    multiple: true,
    options: [
      { key: 'pageSize', label: 'Page size', type: 'select', default: 'fit', choices: [
        { label: 'Fit image exactly', value: 'fit' },
        { label: 'A4 portrait', value: 'a4' },
        { label: 'US Letter', value: 'letter' },
      ] },
      { key: 'margin', label: 'Margin (pt)', type: 'number', default: 0, min: 0, max: 96 },
    ],
  },
  {
    id: 'ai-presentation',
    name: 'AI presentation generation',
    description: 'Build a slide deck outline from a PDF or document.',
    category: 'convert',
    icon: Sparkles,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'slides', label: 'Target slide count', type: 'number', default: 8, min: 3, max: 30 },
      { key: 'tone', label: 'Audience', type: 'select', default: 'professional', choices: [
        { label: 'Professional', value: 'professional' },
        { label: 'Academic', value: 'academic' },
        { label: 'Simple / student', value: 'simple' },
      ] },
    ],
  },
  {
    id: 'mind-map',
    name: 'Mind map generation',
    description: 'Grow a visual map of key ideas into SVG.',
    category: 'convert',
    icon: Map,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'branches', label: 'Main branches', type: 'number', default: 6, min: 3, max: 12 },
      { key: 'details', label: 'Show sub-nodes', type: 'checkbox', default: true },
    ],
  },

  // ---------- Extract ----------
  {
    id: 'extract-text',
    name: 'Extract text',
    description: 'Pull clean, page-by-page text into TXT or Markdown.',
    category: 'extract',
    icon: FileText,
    accept: '.pdf',
    options: [
      { key: 'format', label: 'Output', type: 'select', default: 'md', choices: [
        { label: 'Markdown with page headings', value: 'md' },
        { label: 'Plain text', value: 'txt' },
      ] },
      pageOption(),
    ],
  },
  {
    id: 'extract-images',
    name: 'Extract images',
    description: 'Recover embedded pictures from a PDF into a ZIP.',
    category: 'extract',
    icon: Images,
    accept: '.pdf',
    options: [
      { key: 'minSize', label: 'Minimum width (px)', type: 'number', default: 64, min: 8, max: 4000 },
      pageOption(),
    ],
    outputNote: 'Vector illustrations and full-page scans are not raster objects and will be skipped.',
  },
  {
    id: 'extract-pages',
    name: 'Extract pages',
    description: 'Copy a page selection into a brand-new PDF.',
    category: 'extract',
    icon: FileArchive,
    accept: '.pdf',
    options: [pageOption(''), { key: 'separate', label: 'One PDF per page (ZIP)', type: 'checkbox', default: false }],
  },

  // ---------- Process ----------
  {
    id: 'merge-documents',
    name: 'Merge documents',
    description: 'Join several PDFs into one file, in the order you choose.',
    category: 'process',
    icon: Merge,
    accept: '.pdf',
    multiple: true,
    minFiles: 2,
  },
  {
    id: 'split-pdf',
    name: 'Split PDF',
    description: 'Cut a PDF into ranges, or one file per page.',
    category: 'process',
    icon: Scissors,
    accept: '.pdf',
    options: [
      { key: 'mode', label: 'Split mode', type: 'select', default: 'ranges', choices: [
        { label: 'By page ranges', value: 'ranges' },
        { label: 'Every page separately', value: 'each' },
        { label: 'Every N pages', value: 'every' },
      ] },
      { key: 'ranges', label: 'Ranges', type: 'text', default: '1-1, 2-', help: 'Used for range mode. Example: 1-3, 4-6, 7-' },
      { key: 'size', label: 'Pages per file', type: 'number', default: 2, min: 1, max: 500 },
    ],
  },
  {
    id: 'compress-pdf',
    name: 'Compress PDF',
    description: 'Re-encode pages to shrink image-heavy documents.',
    category: 'process',
    icon: Minimize2,
    accept: '.pdf',
    options: [
      { key: 'level', label: 'Compression', type: 'select', default: 'balanced', choices: [
        { label: 'Strongest — smallest', value: 'strong' },
        { label: 'Balanced', value: 'balanced' },
        { label: 'Light — keep quality', value: 'light' },
      ] },
      pageOption(),
    ],
    outputNote: 'PDFs that are already optimised may get larger; in that case the original is kept.',
  },
  {
    id: 'reduce-size',
    name: 'Reduce file size',
    description: 'Meet a size target by lowering page resolution.',
    category: 'process',
    icon: FileDown,
    accept: '.pdf',
    options: [
      { key: 'target', label: 'Target size (MB)', type: 'number', default: 2, min: 0.1, max: 200, step: 0.1 },
      pageOption(),
    ],
    outputNote: 'Resolution is reduced until the target is met or the minimum quality is reached.',
  },
  {
    id: 'organize-pages',
    name: 'Manage & organize pages',
    description: 'Reorder, rotate and delete pages visually.',
    category: 'process',
    icon: Combine,
    accept: '.pdf',
    launch: 'organizer',
  },
  {
    id: 'translate',
    name: 'Full document translation',
    description: 'Translate the whole text, Hindi ↔ English and more.',
    category: 'process',
    icon: Languages,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'target', label: 'Translate to', type: 'select', default: 'Hindi', choices: [
        { label: 'Hindi', value: 'Hindi' },
        { label: 'English', value: 'English' },
        { label: 'Spanish', value: 'Spanish' },
        { label: 'French', value: 'French' },
        { label: 'German', value: 'German' },
        { label: 'Arabic', value: 'Arabic' },
        { label: 'Chinese (Simplified)', value: 'Chinese (Simplified)' },
      ] },
      { key: 'bilingual', label: 'Include original alongside', type: 'checkbox', default: false },
      pageOption(),
    ],
    outputNote: 'Requires an AI provider in Settings. Output is a DOCX with page sections.',
  },

  // ---------- Learn ----------
  {
    id: 'learning-assistant',
    name: 'Learning assistant',
    description: 'A guided study brief: summary, terms and checks.',
    category: 'learn',
    icon: Brain,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'depth', label: 'Depth', type: 'select', default: 'standard', choices: [
        { label: 'Quick brief', value: 'quick' },
        { label: 'Standard', value: 'standard' },
        { label: 'Deep study', value: 'deep' },
      ] },
    ],
  },
  {
    id: 'flashcards',
    name: 'Create AI flashcards',
    description: 'Question/answer cards you can drill immediately.',
    category: 'learn',
    icon: ListChecks,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [{ key: 'count', label: 'Number of cards', type: 'number', default: 12, min: 4, max: 60 }],
  },
  {
    id: 'quiz',
    name: 'Create AI quiz',
    description: 'Multiple-choice questions with answers and explanations.',
    category: 'learn',
    icon: Sparkles,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'count', label: 'Number of questions', type: 'number', default: 10, min: 3, max: 40 },
      { key: 'difficulty', label: 'Difficulty', type: 'select', default: 'mixed', choices: [
        { label: 'Mixed', value: 'mixed' },
        { label: 'Recall', value: 'easy' },
        { label: 'Applied', value: 'hard' },
      ] },
    ],
  },
  {
    id: 'learning-content',
    name: 'Create learning content',
    description: 'A structured lesson with sections and takeaways.',
    category: 'learn',
    icon: GraduationCap,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'level', label: 'Level', type: 'select', default: 'intermediate', choices: [
        { label: 'Beginner', value: 'beginner' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Advanced', value: 'advanced' },
      ] },
    ],
  },
  {
    id: 'summarize',
    name: 'Summarize study document',
    description: 'Key points and a tight abstract of the source.',
    category: 'learn',
    icon: FileSearch,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [
      { key: 'length', label: 'Summary length', type: 'select', default: 'medium', choices: [
        { label: 'Short — 5 bullets', value: 'short' },
        { label: 'Medium — 8 bullets', value: 'medium' },
        { label: 'Detailed — 14 bullets', value: 'long' },
      ] },
      pageOption(),
    ],
  },
  {
    id: 'generate-questions',
    name: 'Generate questions from PDF',
    description: 'Open questions for revision, viva or homework.',
    category: 'learn',
    icon: MessageSquare,
    accept: '.pdf,.docx,.txt,.md',
    ai: true,
    options: [{ key: 'count', label: 'Number of questions', type: 'number', default: 12, min: 3, max: 40 }],
  },

  // ---------- Annotate ----------
  {
    id: 'annotate-pdf',
    name: 'Annotate PDF',
    description: 'Open the annotation workspace with every markup tool.',
    category: 'annotate',
    icon: PenTool,
    accept: '.pdf',
    launch: 'pdf-viewer',
    viewerMode: 'highlight',
  },
  {
    id: 'highlight-text',
    name: 'Highlight text',
    description: 'Drag highlight bands over any passage.',
    category: 'annotate',
    icon: Highlighter,
    accept: '.pdf',
    launch: 'pdf-viewer',
    viewerMode: 'highlight',
  },
  {
    id: 'add-comments',
    name: 'Add comments',
    description: 'Drop notes on the page and export them with the file.',
    category: 'annotate',
    icon: MessageSquare,
    accept: '.pdf',
    launch: 'pdf-viewer',
    viewerMode: 'comment',
  },
  {
    id: 'add-stamps',
    name: 'Add stamps',
    description: 'Approve, review or mark pages with stamps.',
    category: 'annotate',
    icon: Stamp,
    accept: '.pdf',
    launch: 'pdf-viewer',
    viewerMode: 'stamp',
  },
  {
    id: 'pdf-signature',
    name: 'PDF signature',
    description: 'Sign a page with a typed signature.',
    category: 'annotate',
    icon: PenTool,
    accept: '.pdf',
    options: [
      { key: 'signer', label: 'Signer name', type: 'text', default: '', placeholder: 'Dr A. Sharma' },
      { key: 'page', label: 'Page', type: 'number', default: 1, min: 1 },
      { key: 'position', label: 'Placement', type: 'select', default: 'bottom-right', choices: [
        { label: 'Bottom right', value: 'bottom-right' },
        { label: 'Bottom left', value: 'bottom-left' },
        { label: 'Bottom centre', value: 'bottom-center' },
      ] },
      { key: 'size', label: 'Font size', type: 'number', default: 22, min: 8, max: 60 },
    ],
    outputNote: 'Signatures use the built-in Helvetica face, so Latin names render exactly.',
  },
  {
    id: 'pdf-watermark',
    name: 'PDF watermark',
    description: 'Lay a text watermark across every page.',
    category: 'annotate',
    icon: Highlighter,
    accept: '.pdf',
    options: [
      { key: 'text', label: 'Watermark text', type: 'text', default: 'CONFIDENTIAL' },
      { key: 'opacity', label: 'Opacity', type: 'number', default: 0.18, min: 0.02, max: 1, step: 0.02 },
      { key: 'rotation', label: 'Rotation (°)', type: 'number', default: 45, min: -90, max: 90 },
      { key: 'size', label: 'Font size', type: 'number', default: 60, min: 8, max: 160 },
      { key: 'page', label: 'Pages', type: 'text', default: '', placeholder: 'Blank = all pages' },
    ],
    outputNote: 'Page ranges are supported, e.g. 1-3, 7.',
  },

  // ---------- Recognize (OCR) ----------
  {
    id: 'recognize-scanned-copies',
    name: 'Recognize scanned copies (OCR)',
    description: 'OCR image-only PDFs into searchable documents, with English and Hindi.',
    category: 'extract',
    icon: FileSearch,
    accept: '.pdf',
    launch: 'ocr',
  },

  // ---------- Manage ----------
  {
    id: 'version-history',
    name: 'Version history',
    description: 'Every save is a restore point. Roll back or download one.',
    category: 'manage',
    icon: History,
    accept: '*',
    launch: 'versions',
  },
  {
    id: 'encrypt-document',
    name: 'Encrypt document',
    description: 'Seal any file with a password using AES-256.',
    category: 'manage',
    icon: Lock,
    accept: '*',
    options: [
      { key: 'password', label: 'Password', type: 'text', default: '', placeholder: 'At least 6 characters' },
      { key: 'hint', label: 'Password hint', type: 'text', default: '', placeholder: 'Optional, saved unencrypted' },
    ],
    outputNote: 'Creates an Office Suite encrypted container (.enc), not a PDF-standard password.',
  },
  {
    id: 'decrypt-document',
    name: 'Decrypt document',
    description: 'Open an Office Suite encrypted container.',
    category: 'manage',
    icon: Unlock,
    accept: '.enc',
    options: [{ key: 'password', label: 'Password', type: 'text', default: '' }],
  },
  {
    id: 'document-info',
    name: 'Document information',
    description: 'Read and rewrite the Title, Author and Subject fields.',
    category: 'manage',
    icon: Info,
    accept: '.pdf',
    options: [
      { key: 'title', label: 'Title', type: 'text', default: '' },
      { key: 'author', label: 'Author', type: 'text', default: '' },
      { key: 'subject', label: 'Subject', type: 'text', default: '' },
      { key: 'apply', label: 'Write these values into the PDF', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'file-properties',
    name: 'File properties',
    description: 'Technical inspection: pages, size, fonts and metadata.',
    category: 'manage',
    icon: FileSearch,
    accept: '.pdf',
  },
  {
    id: 'open-with',
    name: 'Open with another app',
    description: 'Hand the file to a desktop application or save a copy.',
    category: 'manage',
    icon: FolderOpen,
    accept: '*',
  },
];

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export function toolsByCategory(id: CategoryId): ToolDef[] {
  return TOOLS.filter((t) => t.category === id);
}

export function defaultsFor(tool: ToolDef | undefined): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const opt of tool?.options ?? []) values[opt.key] = opt.default;
  return values;
}
