import { Card } from '@/components/ui/card';
import type { ActingAsRole, AuditRow } from '@/lib/audit';

export type AuditTableLabels = {
  when: string;
  actor: string;
  /** Which hat the actor wore — the whole reason `acting_as_role` is stored. */
  role: string;
  /** Localized name per `acting_as_role` value. */
  roles: Record<ActingAsRole, string>;
  club: string;
  action: string;
  target: string;
  empty: string;
  /** Rendered in place of an actor or club that has since been deleted. */
  unknown: string;
  /** Rendered under an action whose one row stands for more than one change. */
  cascadeNote: string;
};

/**
 * Actions where ONE row stands for more than one people-affecting change, so the
 * count of rows is not a count of consequences.
 *
 * Spec §4.2 mandates one row per audited function and this list does not change that
 * — inventing per-person rows would make the log a booking history. What it changes is
 * that the reading no longer exists only in a source comment: `markNoShow` writes a
 * single `attendance.noshow` while banning the member, cancelling that member's other
 * bookings inside the penalty window, and promoting a waitlister into each seat it
 * freed — up to seven people-affecting changes behind one entry.
 *
 * Criterion for adding one: the function calls `applySeating`, or deletes a row some
 * other table references `on delete set null`/`cascade`. Each entry below satisfies
 * one of those:
 *   attendance.noshow / attendance.noshow_undo  – ban cascade + applySeating
 *   booking.owner_add / booking.owner_remove    – applySeating (promotion/displacement)
 *   skill_level.delete                          – memberships.skill_level_id set null
 */
const CASCADING_ACTIONS = new Set([
  'attendance.noshow',
  'attendance.noshow_undo',
  'booking.owner_add',
  'booking.owner_remove',
  'skill_level.delete',
]);

/**
 * Prop-driven on purpose: it does no data access, so it can be rendered in jsdom
 * with a deliberately null-everything row. `actor_user_id` and `club_id` are
 * `on delete set null`, and a row whose subject is gone is still evidence — it
 * must render, never crash (spec §4.4).
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
            {/* The column spec §4.1 spent an `ALTER TYPE … ADD VALUE` migration on, so
                that it can say `admin`. Without it the page renders
                "member.approve — actor: Ayşe" about someone who is both a club owner
                and a platform admin, and refuses to say which authority she used.
                Falls back to the raw value rather than blank: a row written by a
                future version is still evidence and must render (spec §4.4). */}
            <dt>{labels.role}</dt>
            <dd className="break-all text-foreground">
              {r.actingAsRole ? labels.roles[r.actingAsRole] ?? r.actingAsRole : labels.unknown}
            </dd>
            <dt>{labels.club}</dt>
            <dd className="break-all text-foreground">{r.clubName ?? r.clubId ?? labels.unknown}</dd>
            <dt>{labels.target}</dt>
            {/* Free text holding an id — rendered verbatim, never resolved (spec §4.4). */}
            <dd className="break-all text-foreground">{r.target ?? labels.unknown}</dd>
          </dl>
          {CASCADING_ACTIONS.has(r.action) && (
            <p className="text-xs text-muted-foreground italic">{labels.cascadeNote}</p>
          )}
        </div>
      ))}
    </Card>
  );
}
