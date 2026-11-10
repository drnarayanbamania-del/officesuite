import { isAIReady, chat, parseJSONish, type AIConfig } from '../lib/ai';

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizItem {
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
}

export interface LearnSection {
  heading: string;
  body: string;
  bullets?: string[];
}

export interface DeckOutline {
  title: string;
  subtitle?: string;
  slides: { title: string; bullets: string[]; notes?: string }[];
}

export interface MindmapNode {
  label: string;
  children: string[];
}

export interface MindmapData {
  root: string;
  branches: MindmapNode[];
}

export interface LearnBundle {
  title: string;
  summary: string;
  bullets: string[];
  flashcards: Flashcard[];
  quiz: QuizItem[];
  questions: string[];
  sections: LearnSection[];
  deck: DeckOutline;
  mindmap: MindmapData;
  translation?: string;
  notes: string[];
  usedAI: boolean;
}

export type LearnKind =
  | 'summary'
  | 'flashcards'
  | 'quiz'
  | 'questions'
  | 'guide'
  | 'lesson'
  | 'deck'
  | 'mindmap';

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also may might must shall using used use one two three first second new can could within without however therefore thus among across per via etc fig figure table chapter section`
    .split(/\s+/)
    .filter(Boolean)
);

export function cleanText(input: string): string {
  return input
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sentencesOf(text: string): string[] {
  const normalized = cleanText(text).replace(/\n+/g, ' ');
  const found = normalized.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? normalized.split(/(?<=[.!?])\s+/);
  const cleaned = found
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 35 && s.length <= 400);
  if (cleaned.length >= 4) return cleaned;
  return normalized
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length > 4 && s.length <= 400);
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function frequencies(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of wordsOf(text)) freq.set(word, (freq.get(word) ?? 0) + 1);
  return freq;
}

function titleCase(word: string): string {
  return word.length ? word[0].toUpperCase() + word.slice(1) : word;
}

export function keyTerms(text: string, limit = 14): { term: string; count: number }[] {
  const display = new Map<string, string>();
  for (const match of text.matchAll(/[A-Za-z\u0900-\u097F][A-Za-z0-9\u0900-\u097F-]{3,}/g)) {
    const lower = match[0].toLowerCase();
    if (!display.has(lower)) display.set(lower, match[0]);
  }
  return [...frequencies(text).entries()]
    .filter(([word]) => word.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ term: display.get(word) ?? titleCase(word), count }));
}

export function summarizeText(text: string, target = 6): string {
  const sentences = sentencesOf(text);
  if (!sentences.length) return cleanText(text).slice(0, 600);
  const freq = frequencies(text);
  const max = Math.max(1, ...freq.values());
  const scored = sentences.map((sentence, index) => {
    const words = wordsOf(sentence);
    if (!words.length) return { sentence, score: 0, index };
    const density = words.reduce((sum, w) => sum + (freq.get(w) ?? 0) / max, 0) / Math.sqrt(words.length);
    const positionBoost = index < 3 ? 0.22 : index < 8 ? 0.1 : 0;
    const numberBoost = /\d/.test(sentence) ? 0.06 : 0;
    return { sentence, score: density + positionBoost + numberBoost, index };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, target))
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence)
    .join(' ');
}

function definitionPairs(text: string): { term: string; definition: string }[] {
  const pairs: { term: string; definition: string }[] = [];
  for (const sentence of sentencesOf(text)) {
    const match = sentence.match(
      /^([A-Z\u0900-\u097F][\w\u0900-\u097F-]*(?:\s+[\w\u0900-\u097F-]+){0,3})\s+(?:is|are|means|refers to|is defined as|describes)\s+([^.!?]{12,240})/
    );
    if (match && !STOPWORDS.has(match[1].toLowerCase())) {
      pairs.push({ term: match[1].trim(), definition: sentence.trim() });
    }
  }
  return pairs;
}

export function buildFlashcards(text: string, count = 12): Flashcard[] {
  const cards: Flashcard[] = [];
  const seen = new Set<string>();
  for (const pair of definitionPairs(text)) {
    const key = pair.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ front: `What is ${pair.term}?`, back: pair.definition });
    if (cards.length >= count) return cards;
  }
  const terms = keyTerms(text, count * 2);
  for (const { term } of terms) {
    if (cards.length >= count) break;
    const sentence = sentencesOf(text).find((s) => s.toLowerCase().includes(term.toLowerCase()));
    if (!sentence || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const blanked = sentence.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '________');
    cards.push({ front: blanked, back: term });
  }
  for (const sentence of sentencesOf(text)) {
    if (cards.length >= count) break;
    if (cards.some((c) => c.back === sentence)) continue;
    const words = sentence.split(/\s+/).filter((w) => w.length > 5 && !STOPWORDS.has(w.toLowerCase()));
    if (!words.length) continue;
    const target = words[0];
    cards.push({
      front: sentence.replace(target, '________'),
      back: target.replace(/[.,;:]$/, ''),
    });
  }
  return cards.slice(0, count);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildQuiz(text: string, count = 10): QuizItem[] {
  const terms = keyTerms(text, count * 3).map((t) => t.term);
  const sentences = sentencesOf(text);
  const quiz: QuizItem[] = [];
  for (const sentence of sentences) {
    if (quiz.length >= count) break;
    const word = terms.find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence));
    if (!word) continue;
    const distractors = shuffle(terms.filter((t) => t.toLowerCase() !== word.toLowerCase())).slice(0, 3);
    if (distractors.length < 3) continue;
    const options = shuffle([word, ...distractors]);
    quiz.push({
      question: sentence.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '________'),
      options,
      answer: options.findIndex((o) => o.toLowerCase() === word.toLowerCase()),
      explanation: `The source reads: “${sentence}”`,
    });
  }
  if (quiz.length) return quiz;
  return terms.slice(0, count).map((term, index) => {
    const others = terms.filter((t) => t !== term).slice(0, 3);
    const options = shuffle([term, ...others]);
    return {
      question: `Which of these is a key term from the source? (#${index + 1})`,
      options,
      answer: options.indexOf(term),
      explanation: `${term} appears repeatedly in the document.`,
    };
  });
}

export function buildQuestions(text: string, count = 12): string[] {
  const questions: string[] = [];
  for (const pair of definitionPairs(text)) {
    if (questions.length >= count) break;
    questions.push(`What is ${pair.term}, and why does it matter in this document?`);
  }
  for (const term of keyTerms(text, count * 2)) {
    if (questions.length >= count) break;
    questions.push(`Explain the role of ${term.term} using evidence from the source.`);
  }
  for (const sentence of sentencesOf(text)) {
    if (questions.length >= count) break;
    if (/\d/.test(sentence)) {
      const short = sentence.split(/\s+/).slice(0, 9).join(' ');
      questions.push(`The document states a figure or date here: “${short}…”. What does it measure, and what follows from it?`);
    }
  }
  for (const sentence of sentencesOf(text)) {
    if (questions.length >= count) break;
    const short = sentence.split(/\s+/).slice(0, 10).join(' ');
    questions.push(`Assess this claim: “${short}…”. Is it supported, and what is the counter-argument?`);
  }
  return questions.slice(0, count);
}

export function buildOutline(text: string, slideCount = 8): DeckOutline {
  const sentences = sentencesOf(text);
  const perSlide = Math.max(2, Math.ceil(sentences.length / Math.max(3, slideCount)));
  const slides: DeckOutline['slides'] = [];
  slides.push({
    title: 'Overview',
    bullets: [
      summarizeText(text, 3).slice(0, 420),
      `${sentences.length} statements analysed`,
    ],
  });
  const terms = keyTerms(text, slideCount).map((t) => t.term);
  for (const term of terms) {
    if (slides.length >= slideCount) break;
    const related = sentences.filter((s) => s.toLowerCase().includes(term.toLowerCase())).slice(0, 4);
    slides.push({
      title: titleCase(term),
      bullets: related.length
        ? related.map((s) => s.slice(0, 180))
        : sentences.slice(0, 3).map((s) => s.slice(0, 180)),
    });
  }
  let cursor = 0;
  while (slides.length < slideCount && sentences.length) {
    const chunk = sentences.slice(cursor, cursor + perSlide);
    cursor += perSlide;
    if (!chunk.length) break;
    slides.push({
      title: `Key idea ${slides.length}`,
      bullets: chunk.map((s) => s.slice(0, 180)),
    });
  }
  return {
    title: 'Presentation',
    subtitle: 'Generated from your source document',
    slides: slides.slice(0, Math.max(3, slideCount)),
  };
}

export function buildOutlineFromPages(
  pages: { pageNumber: number; lines: { text: string }[] }[],
  slideCount = 8
): DeckOutline {
  const usable = pages.filter((p) => p.lines.length);
  if (usable.length < 2) return buildOutline(usable.map((p) => p.lines.map((l) => l.text).join(' ')).join(' '), slideCount);
  const per = Math.max(1, Math.ceil(usable.length / Math.max(3, slideCount - 1)));
  const slides: DeckOutline['slides'] = [
    {
      title: usable[0].lines[0]?.text.slice(0, 90) || 'Overview',
      bullets: usable[0].lines.slice(1, 6).map((l) => l.text.slice(0, 160)),
    },
  ];
  for (let i = 1; i < usable.length && slides.length < slideCount; i += per) {
    const group = usable.slice(i, i + per);
    const first = group[0].lines[0]?.text ?? `Pages ${group[0].pageNumber}`;
    slides.push({
      title: (first.length <= 80 ? first : `Pages ${group[0].pageNumber}–${group[group.length - 1].pageNumber}`).slice(0, 90),
      bullets: group
        .flatMap((p) => p.lines.slice(0, 4).map((l) => l.text.slice(0, 150)))
        .slice(0, 6),
    });
  }
  return { title: 'PDF presentation', subtitle: 'Outline generated from your document', slides };
}

export function buildMindmap(text: string, branchCount = 6, details = true): MindmapData {
  const terms = keyTerms(text, branchCount);
  const sentences = sentencesOf(text);
  const root = (sentences[0] ?? cleanText(text)).split(/\s+/).slice(0, 7).join(' ').replace(/[.,;:]$/, '') || 'Document';
  return {
    root,
    branches: terms.map(({ term }) => ({
      label: titleCase(term),
      children: details
        ? sentences.filter((s) => s.toLowerCase().includes(term.toLowerCase())).slice(0, 3).map((s) => s.slice(0, 110))
        : [],
    })),
  };
}

export function buildSections(text: string, kind: 'guide' | 'lesson', depth = 'standard'): LearnSection[] {
  const summary = summarizeText(text, depth === 'deep' ? 10 : depth === 'quick' ? 4 : 6);
  const paragraphs = cleanText(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 60)
    .slice(0, 8);
  const terms = keyTerms(text, 10);
  const sections: LearnSection[] = [
    {
      heading: 'At a glance',
      body: summary,
      bullets: terms.slice(0, 5).map((t) => `Recurring concept: ${t.term}`),
    },
    {
      heading: 'Key terms',
      body: 'Definitions reconstructed from the document’s own wording.',
      bullets: definitionPairs(text)
        .slice(0, 8)
        .map((p) => `${p.term} — ${p.definition.replace(/^[^,]*?,?\s*/, '').slice(0, 200)}`),
    },
  ];
  paragraphs.slice(0, kind === 'lesson' ? 5 : 3).forEach((paragraph, index) => {
    sections.push({
      heading: `Section ${index + 1}`,
      body: paragraph.slice(0, 1600),
      bullets: depth === 'deep' ? sentencesOf(paragraph).slice(0, 3) : undefined,
    });
  });
  sections.push({
    heading: 'Check your understanding',
    body: 'Answer these before moving on.',
    bullets: buildQuestions(text, depth === 'deep' ? 8 : 5),
  });
  return sections;
}

export function mindmapToSvg(map: MindmapData): string {
  const branchHeight = map.branches.some((b) => b.children.length) ? 118 : 78;
  const height = Math.max(520, map.branches.length * branchHeight + 120);
  const width = 1180;
  const cx = width / 2;
  const cy = height / 2;
  const colors = ['#2563EB', '#059669', '#7C3AED', '#D97706', '#DC2626', '#0891B2', '#4F46E5', '#BE185D'];
  const cards: string[] = [];
  const paths: string[] = [];
  const total = map.branches.length || 1;

  map.branches.forEach((branch, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    const slot = Math.floor(index / 2);
    const y = cy + (slot - (Math.ceil(total / 2) - 1) / 2) * branchHeight;
    const x = cx + side * 330;
    const color = colors[index % colors.length];
    paths.push(
      `<path d="M ${cx + side * 104} ${cy} C ${cx + side * 190} ${cy}, ${x - side * 150} ${y}, ${x - side * 74} ${y}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.55" />`
    );
    const label = branch.label.length > 26 ? `${branch.label.slice(0, 25)}…` : branch.label;
    cards.push(
      `<g><rect x="${x - (side === 1 ? 74 : 160)}" y="${y - 22}" width="234" height="44" rx="22" fill="${color}" opacity="0.12" />` +
        `<text x="${x}" y="${y + 5}" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" font-size="14" font-weight="600" fill="${color}">${escapeXml(label)}</text></g>`
    );
    branch.children.slice(0, 3).forEach((child, childIndex) => {
      const childY = y + 30 + childIndex * 24;
      const childX = side === 1 ? x - 60 : x + 60;
      const short = child.length > 46 ? `${child.slice(0, 45)}…` : child;
      paths.push(
        `<line x1="${side === 1 ? x + 74 : x - 74}" y1="${y + 8}" x2="${side === 1 ? childX - 4 : childX + 4}" y2="${childY - 4}" stroke="${color}" stroke-width="1" opacity="0.3" />`
      );
      cards.push(
        `<text x="${childX}" y="${childY}" text-anchor="${side === 1 ? 'start' : 'end'}" font-family="Inter, Segoe UI, sans-serif" font-size="11" fill="#475569">${escapeXml(short)}</text>`
      );
    });
  });

  const rootLabel = map.root.length > 34 ? `${map.root.slice(0, 33)}…` : map.root;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${paths.join('\n  ')}
  ${cards.join('\n  ')}
  <circle cx="${cx}" cy="${cy}" r="104" fill="#0F172A" />
  <circle cx="${cx}" cy="${cy}" r="94" fill="none" stroke="#38BDF8" stroke-opacity="0.4" />
  <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" font-size="15" font-weight="700" fill="#F8FAFC">${escapeXml(rootLabel)}</text>
  <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" font-size="10" fill="#94A3B8">SOURCE DOCUMENT</text>
</svg>`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface LearnOptions {
  count?: number;
  slideCount?: number;
  branchCount?: number;
  details?: boolean;
  depth?: string;
  level?: string;
  pages?: { pageNumber: number; lines: { text: string }[] }[];
}

function offlineBundle(text: string, options: LearnOptions): LearnBundle {
  const count = options.count ?? 12;
  const cards = buildFlashcards(text, count);
  const quiz = buildQuiz(text, Math.min(count, 20));
  const questions = buildQuestions(text, count);
  const terms = keyTerms(text, 12);
  const summary = summarizeText(text, options.depth === 'quick' ? 5 : options.depth === 'deep' ? 12 : 7);
  return {
    title: 'Study brief',
    summary,
    bullets: terms.slice(0, 8).map((t) => `${t.term} — referenced ${t.count}×`),
    flashcards: cards,
    quiz,
    questions,
    sections: buildSections(text, 'lesson', options.depth),
    deck: options.pages?.length
      ? buildOutlineFromPages(options.pages, options.slideCount ?? 8)
      : buildOutline(text, options.slideCount ?? 8),
    mindmap: buildMindmap(text, options.branchCount ?? 6, options.details ?? true),
    notes: [],
    usedAI: false,
  };
}

const AI_SHAPE = `{
  "title": "short document title",
  "summary": "2-4 sentence abstract",
  "bullets": ["6-10 key takeaways"],
  "flashcards": [{"front": "question", "back": "answer"}],
  "quiz": [{"question": "…", "options": ["4 options"], "answer": 0, "explanation": "…"}],
  "questions": ["open revision questions"],
  "sections": [{"heading": "…", "body": "…", "bullets": ["…"]}],
  "deck": {"title": "…", "subtitle": "…", "slides": [{"title": "…", "bullets": ["…"], "notes": "…"}]},
  "mindmap": {"root": "…", "branches": [{"label": "…", "children": ["…"]}]}
}`;

async function requestAI(
  kind: LearnKind,
  text: string,
  ai: AIConfig,
  options: LearnOptions
): Promise<Partial<LearnBundle>> {
  const count = options.count ?? 12;
  const tasks: Record<LearnKind, string> = {
    summary: `Summarise the document for a student. Provide a ${options.depth === 'quick' ? 'brief' : options.depth === 'deep' ? 'detailed' : 'clear'} abstract, 5-8 key bullets and 5 revision questions.`,
    flashcards: `Create exactly ${count} flashcards. Each front must be a single clear question or cloze deletion; each back a complete answer drawn from the text.`,
    quiz: `Create exactly ${count} multiple-choice questions (${options.depth ?? 'mixed'} difficulty). Each has exactly 4 options, one answer (zero-based index) and a one-sentence explanation.`,
    questions: `Write ${count} exam-style open questions covering the whole document, from recall to application.`,
    guide: `Produce a structured study guide: abstract, key terms with meanings, 4-6 sections of explanation, and 6 self-check questions. Use the "sections" array.`,
    lesson: `Write a ${options.level ?? 'intermediate'} lesson. Use "sections" with a heading, explanatory body and optional bullets for each part, then a recap.`,
    deck: `Design a ${options.slideCount ?? 8} slide presentation (excluding the title slide). Fill the "deck" object with concise slide titles and 3-5 bullets each.`,
    mindmap: `Build a mind map with a root concept, ${options.branchCount ?? 6} branches and ${options.details ? '2-3 child ideas per branch' : 'no children'}. Fill the "mindmap" object.`,
  };
  const source = cleanText(text).slice(0, 14000);
  const raw = await chat(
    ai,
    [
      {
        role: 'system',
        content:
          'You are a meticulous study assistant. Work only from the supplied source, never invent facts. Reply with valid JSON only, no prose and no code fences, matching the requested shape.',
      },
      {
        role: 'user',
        content: `${tasks[kind]}\n\nReturn JSON shaped like:\n${AI_SHAPE}\n\nInclude only the keys relevant to this task (you may include more if useful). Source:\n"""\n${source}\n"""`,
      },
    ],
    2600
  );
  return parseJSONish<Partial<LearnBundle>>(raw);
}

function mergeBundle(offline: LearnBundle, ai: Partial<LearnBundle>): LearnBundle {
  return {
    title: ai.title?.trim() || offline.title,
    summary: ai.summary?.trim() || offline.summary,
    bullets: Array.isArray(ai.bullets) && ai.bullets.length ? ai.bullets.map(String) : offline.bullets,
    flashcards: Array.isArray(ai.flashcards) && ai.flashcards.length
      ? ai.flashcards
          .filter((c) => c && typeof c.front === 'string' && typeof c.back === 'string')
          .map((c) => ({ front: String(c.front), back: String(c.back) }))
      : offline.flashcards,
    quiz: Array.isArray(ai.quiz) && ai.quiz.length
      ? ai.quiz
          .filter((q) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
          .map((q) => ({
            question: String(q.question),
            options: q.options.map(String).slice(0, 6),
            answer: Math.max(0, Math.min((q.options as unknown[]).length - 1, Number(q.answer) || 0)),
            explanation: q.explanation ? String(q.explanation) : undefined,
          }))
      : offline.quiz,
    questions: Array.isArray(ai.questions) && ai.questions.length ? ai.questions.map(String) : offline.questions,
    sections: Array.isArray(ai.sections) && ai.sections.length
      ? ai.sections
          .filter((s) => s && typeof s.heading === 'string')
          .map((s) => ({
            heading: String(s.heading),
            body: String(s.body ?? ''),
            bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : undefined,
          }))
      : offline.sections,
    deck:
      ai.deck && Array.isArray(ai.deck.slides) && ai.deck.slides.length
        ? {
            title: ai.deck.title ?? offline.deck.title,
            subtitle: ai.deck.subtitle ?? offline.deck.subtitle,
            slides: ai.deck.slides
              .filter((s) => s && typeof s.title === 'string')
              .map((s) => ({
                title: String(s.title),
                bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [],
                notes: s.notes ? String(s.notes) : undefined,
              })),
          }
        : offline.deck,
    mindmap:
      ai.mindmap && Array.isArray(ai.mindmap.branches) && ai.mindmap.branches.length
        ? {
            root: ai.mindmap.root ?? offline.mindmap.root,
            branches: ai.mindmap.branches
              .filter((b) => b && typeof b.label === 'string')
              .map((b) => ({
                label: String(b.label),
                children: Array.isArray(b.children) ? b.children.map(String) : [],
              })),
          }
        : offline.mindmap,
    translation: ai.translation,
    notes: offline.notes,
    usedAI: true,
  };
}

export async function learn(
  kind: LearnKind,
  text: string,
  ai: AIConfig | null,
  options: LearnOptions = {}
): Promise<LearnBundle> {
  const offline = offlineBundle(text, options);
  if (!isAIReady(ai)) {
    offline.notes.push(
      'Offline study engine: summaries are extractive and cards are built from the document’s own sentences. Add an AI provider in Settings for generative output.'
    );
    return offline;
  }
  try {
    const result = await requestAI(kind, text, ai, options);
    return mergeBundle(offline, result);
  } catch (error: any) {
    offline.notes.push(`AI request failed: ${error?.message ?? 'unknown error'}. The offline engine produced this instead.`);
    return offline;
  }
}

export async function translateText(
  text: string,
  target: string,
  ai: AIConfig | null,
  onProgress?: (ratio: number) => void
): Promise<string> {
  if (!isAIReady(ai)) {
    throw new Error('Translation needs an AI provider. Add a base URL, model and API key in Settings.');
  }
  const clean = cleanText(text);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of clean.split(/\n{2,}/)) {
    if ((current + paragraph).length > 3200) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current += `${current ? '\n\n' : ''}${paragraph}`;
    }
  }
  if (current) chunks.push(current);
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const translated = await chat(
      ai,
      [
        {
          role: 'system',
          content: `You are a professional translator. Translate faithfully into ${target}, preserving paragraph breaks, headings, numbers and names. Return only the translation.`,
        },
        { role: 'user', content: chunks[i] },
      ],
      3000
    );
    out.push(translated);
    onProgress?.((i + 1) / chunks.length);
  }
  return out.join('\n\n');
}

export function bundleToSections(bundle: LearnBundle, kind: LearnKind): LearnSection[] {
  switch (kind) {
    case 'summary':
      return [
        { heading: 'Summary', body: bundle.summary },
        { heading: 'Key points', body: '', bullets: bundle.bullets },
        { heading: 'Revision questions', body: '', bullets: bundle.questions },
      ];
    case 'quiz':
      return [
        { heading: 'Quiz', body: `Attempt all ${bundle.quiz.length} questions before checking the key.` },
        ...bundle.quiz.map((q, i) => ({
          heading: `Q${i + 1}. ${q.question}`,
          bullets: q.options.map((opt, oi) => `${String.fromCharCode(65 + oi)}. ${opt}`),
          body: '',
        })),
        {
          heading: 'Answer key',
          body: '',
          bullets: bundle.quiz.map(
            (q, i) =>
              `Q${i + 1}: ${String.fromCharCode(65 + q.answer)} — ${q.options[q.answer]}${q.explanation ? ` (${q.explanation})` : ''}`
          ),
        },
      ];
    case 'flashcards':
      return [
        { heading: 'Flashcards', body: `${bundle.flashcards.length} cards generated from the source.` },
        ...bundle.flashcards.map((card, i) => ({
          heading: `Card ${i + 1}`,
          body: `Front: ${card.front}\n\nBack: ${card.back}`,
        })),
      ];
    case 'questions':
      return [{ heading: 'Questions', body: '', bullets: bundle.questions }];
    case 'guide':
    case 'lesson':
      return bundle.sections;
    default:
      return [{ heading: 'Summary', body: bundle.summary, bullets: bundle.bullets }];
  }
}
