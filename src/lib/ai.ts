import { getSetting, setSetting } from './db';

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const SETTINGS_KEY = 'novaoffice.ai';

export const DEFAULT_AI: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export async function loadAIConfig(): Promise<AIConfig> {
  const stored = await getSetting<Partial<AIConfig>>(SETTINGS_KEY, {});
  return { ...DEFAULT_AI, ...stored };
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  await setSetting(SETTINGS_KEY, config);
}

export function isAIReady(config: AIConfig | null | undefined): config is AIConfig {
  return Boolean(config && config.apiKey.trim() && config.baseUrl.trim() && config.model.trim());
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chat(config: AIConfig, messages: ChatMessage[], maxTokens = 1600): Promise<string> {
  if (!isAIReady(config)) throw new Error('No AI provider is configured. Add an API key in Settings.');
  const endpoint = `${config.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model.trim(),
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI request failed (${response.status}). ${detail.slice(0, 240)}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The AI provider returned an unexpected response.');
  return content.trim();
}

export function parseJSONish<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = Math.min(
      ...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0).concat([cleaned.length])
    );
    const endBrace = cleaned.lastIndexOf('}');
    const endBracket = cleaned.lastIndexOf(']');
    const end = Math.max(endBrace, endBracket);
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error('Could not read the AI response as JSON.');
  }
}
