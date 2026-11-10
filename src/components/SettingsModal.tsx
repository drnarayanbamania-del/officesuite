import { useEffect, useState } from 'react';
import { Database, HardDrive, KeyRound, Trash2 } from 'lucide-react';
import { loadAIConfig, saveAIConfig, DEFAULT_AI, type AIConfig } from '../lib/ai';
import { clearAllData } from '../lib/db';
import { humanSize } from '../lib/files';
import { toast } from '../lib/ui';
import { useFiles } from '../store/files';
import { Modal } from './ui';

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [config, setConfig] = useState<AIConfig>(DEFAULT_AI);
  const [usage, setUsage] = useState<string>('—');
  const [busy, setBusy] = useState(false);
  const refresh = useFiles((s) => s.refresh);
  const files = useFiles((s) => s.files);

  useEffect(() => {
    if (!open) return;
    loadAIConfig().then(setConfig);
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (estimate.usage !== undefined) setUsage(humanSize(estimate.usage));
      })
      .catch(() => setUsage('—'));
  }, [open]);

  const save = async () => {
    await saveAIConfig(config);
    toast('Settings saved');
    onClose();
  };

  const wipe = async () => {
    if (!window.confirm('Delete every document, version and setting stored in this browser? This cannot be undone.')) return;
    setBusy(true);
    await clearAllData();
    await refresh();
    localStorage.removeItem('novaoffice.theme');
    setBusy(false);
    toast('Local workspace cleared');
    onClose();
  };

  const stored = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      description="Everything is stored on this device. No account and no server."
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save settings
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-ink">AI provider (optional)</h3>
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            Used by the learning tools, translation and AI deck generation. Any OpenAI-compatible endpoint works. The key is
            stored only in this browser’s IndexedDB and is sent directly to the endpoint you choose.
          </p>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="ai-base">
                Base URL
              </label>
              <input
                id="ai-base"
                className="field font-mono text-xs"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="label" htmlFor="ai-model">
                Model
              </label>
              <input
                id="ai-model"
                className="field font-mono text-xs"
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div>
              <label className="label" htmlFor="ai-key">
                API key
              </label>
              <input
                id="ai-key"
                className="field font-mono text-xs"
                type="password"
                autoComplete="off"
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="sk-…"
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Without a key the study tools still work using the offline engine, which summarises and quizzes from the
            document’s own sentences. Translation and AI deck generation require a key.
          </p>
        </section>

        <section className="rounded-xl border border-line bg-sunken/60 p-3.5">
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-ink-soft" />
            <h3 className="text-sm font-semibold text-ink">Local storage</h3>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-ink-muted">Documents</dt>
            <dd className="text-right tabular-nums text-ink">{files.length}</dd>
            <dt className="text-ink-muted">Document bytes</dt>
            <dd className="text-right tabular-nums text-ink">{humanSize(stored)}</dd>
            <dt className="text-ink-muted">Browser usage</dt>
            <dd className="text-right tabular-nums text-ink">{usage}</dd>
          </dl>
        </section>

        <section className="flex items-center justify-between gap-3 rounded-xl border border-rose-200/70 bg-rose-50/50 p-3.5 dark:border-rose-500/20 dark:bg-rose-500/5">
          <div>
            <p className="text-sm font-medium text-ink">Clear this device</p>
            <p className="text-xs text-ink-muted">Removes files, versions, settings and the AI key.</p>
          </div>
          <button className="btn-danger shrink-0" onClick={wipe} disabled={busy}>
            <Trash2 className="h-4 w-4" />
            {busy ? 'Clearing…' : 'Clear'}
          </button>
        </section>
      </div>
    </Modal>
  );
}
