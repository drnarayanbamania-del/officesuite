import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToasts } from '../lib/ui';

export function Toasts() {
  const { items, dismiss } = useToasts();
  if (!items.length) return null;
  const icons = { ok: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
      {items.map((item) => {
        const Icon = icons[item.kind];
        return (
          <div
            key={item.id}
            className={clsx(
              'pointer-events-auto flex animate-fadeUp items-start gap-3 rounded-xl border bg-raised px-3.5 py-3 shadow-pop',
              item.kind === 'error' ? 'border-rose-300/60' : item.kind === 'ok' ? 'border-emerald-300/50' : 'border-line'
            )}
          >
            <Icon
              className={clsx(
                'mt-0.5 h-4 w-4 shrink-0',
                item.kind === 'error' ? 'text-rose-500' : item.kind === 'ok' ? 'text-emerald-500' : 'text-brand-500'
              )}
            />
            <p className="flex-1 text-sm leading-snug text-ink">{item.message}</p>
            <button className="icon-btn -mr-1 -mt-1 h-6 w-6" onClick={() => dismiss(item.id)} aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
