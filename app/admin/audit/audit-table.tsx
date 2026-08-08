import { Card } from '@/components/ui/card';
import type { AuditRow } from '@/lib/audit';

export type AuditTableLabels = {
  when: string;
  actor: string;
  club: string;
  action: string;
  target: string;
  empty: string;
  /** Rendered in place of an actor or club that has since been deleted. */
  unknown: string;
};

/**
 * Prop-driven on purpose: it does no data access, so it can be rendered in jsdom
 * with a deliberately null-everything row. `actor_user_id` and `club_id` are
 * `on delete set null`, and a row whose subject is gone is still evidence — it
 * must render, never crash (spec §4.4).
 *
 * One row is one MUTATION, not one affected person: `attendance.noshow` covers
 * every seat its ban cascade cancelled and every waitlister it promoted, under a
 * single entry (spec §4.2). Nothing here should be read as a per-person receipt.
 */
export function AuditTable({ rows, labels, locale, timeZone }: {
  rows: AuditRow[];
  labels: AuditTableLabels;
  locale: string;
  timeZone: string;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground">{labels.empty}</p>;
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-1 p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-heading font-semibold" title={labels.action}>{r.action}</span>
            <time
              dateTime={r.createdAt.toISOString()}
              title={labels.when}
              className="text-xs text-muted-foreground"
            >
              {fmt.format(r.createdAt)}
            </time>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <dt>{labels.actor}</dt>
            <dd className="text-foreground">
              {/* A name if we have one, the raw id if the account is gone but the id
                  survived, and the placeholder only when both are null. */}
              <span className="break-all">{r.actorName ?? r.actorUserId ?? labels.unknown}</span>
              {r.actorEmail && <span className="ml-2 break-all text-muted-foreground">{r.actorEmail}</span>}
            </dd>
            <dt>{labels.club}</dt>
            <dd className="break-all text-foreground">{r.clubName ?? r.clubId ?? labels.unknown}</dd>
            <dt>{labels.target}</dt>
            {/* Free text holding an id — rendered verbatim, never resolved (spec §4.4). */}
            <dd className="break-all text-foreground">{r.target ?? labels.unknown}</dd>
          </dl>
        </div>
      ))}
    </Card>
  );
}
