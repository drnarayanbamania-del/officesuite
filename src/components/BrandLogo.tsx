import clsx from 'clsx';
import { useState } from 'react';

const LOGO_SRC = '/brand/bamania-tech-logo.png';

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={clsx(
        'grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-500 via-fuchsia-600 to-blue-600 font-black text-white ring-1 ring-inset ring-white/25',
        small ? 'h-9 w-9 text-lg shadow-[0_4px_10px_-4px_rgba(59,7,100,.55)]' : 'h-12 w-12 text-2xl shadow-[0_8px_18px_-8px_rgba(59,7,100,.6)]'
      )}
      aria-hidden="true"
    >
      B
    </span>
  );
}

function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="min-w-0 leading-tight">
      <p className={clsx('brand-wordmark truncate font-display font-extrabold tracking-[-0.02em]', small ? 'text-[13px]' : 'text-lg')}>
        OFFICE SUITE
      </p>
      <p
        className={clsx(
          'truncate font-semibold uppercase text-ink-muted',
          small ? 'text-[9px] tracking-[0.16em]' : 'text-[10px] tracking-[0.22em]'
        )}
      >
        By Bamania&apos;s Tech
      </p>
    </div>
  );
}

/**
 * Brand lockup. Uses the supplied logo when it exists at
 * /brand/bamania-tech-logo.png and falls back to a typographic mark until then.
 */
export function BrandLogo({
  variant = 'compact',
  className,
}: {
  variant?: 'compact' | 'full' | 'mark';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (variant === 'mark') {
    return (
      <span className={clsx('block h-9 w-9 overflow-hidden rounded-xl bg-white shadow-[0_4px_12px_-6px_rgba(15,23,42,.4)] ring-1 ring-black/5', className)}>
        {failed ? (
          <Mark small />
        ) : (
          <img
            src={LOGO_SRC}
            alt="Bamania's Tech"
            className="h-full w-full object-cover"
            style={{ objectPosition: '62% 28%' }}
            onError={() => setFailed(true)}
          />
        )}
      </span>
    );
  }

  if (variant === 'full') {
    return (
      <div className={clsx('flex items-center', className)}>
        {failed ? (
          <div className="flex items-center gap-3">
            <Mark />
            <Wordmark />
          </div>
        ) : (
          <div className="inline-flex max-w-full items-center rounded-2xl bg-white p-2.5 shadow-[0_18px_40px_-22px_rgba(15,23,42,.45)] ring-1 ring-black/5">
            <img
              src={LOGO_SRC}
              alt="Bamania's Tech — Learn, Build, Grow"
              className="h-24 w-auto max-w-[280px] object-contain sm:h-28"
              onError={() => setFailed(true)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={clsx('flex min-w-0 items-center gap-2.5', className)}>
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
        {failed ? (
          <Mark small />
        ) : (
          <img
            src={LOGO_SRC}
            alt="Bamania's Tech"
            className="h-full w-full object-cover"
            style={{ objectPosition: '62% 28%' }}
            onError={() => setFailed(true)}
          />
        )}
      </span>
      <Wordmark small />
    </div>
  );
}
