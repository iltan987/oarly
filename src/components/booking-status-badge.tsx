import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';
export type BookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';

const toneClass: Record<BadgeTone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-brand-tint text-brand',
};

export const toneByStatus: Record<BookingStatus, BadgeTone> = {
  booked: 'accent',
  waitlisted: 'warn',
  attended: 'ok',
  no_show: 'bad',
  cancelled: 'neutral',
};

export function StatusPill({
  tone,
  className,
  children,
}: {
  tone: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center rounded-pill px-2.5 py-1 font-heading text-xs font-bold whitespace-nowrap', toneClass[tone], className)}>
      {children}
    </span>
  );
}
