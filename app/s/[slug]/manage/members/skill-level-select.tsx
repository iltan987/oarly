'use client';

import { Field, FieldLabel } from '@/components/ui/field';

import { assignSkillAction } from './actions';

export function SkillLevelSelect({
  slug,
  membershipId,
  skillLevels,
  currentSkillLevelId,
  label,
  noneLabel,
}: {
  slug: string;
  membershipId: string;
  skillLevels: { id: string; name: string }[];
  currentSkillLevelId: string | null;
  label: string;
  noneLabel: string;
}) {
  return (
    <form action={assignSkillAction.bind(null, slug)}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <Field>
        <FieldLabel htmlFor={`skill-${membershipId}`} className="sr-only">{label}</FieldLabel>
        {/*
          Uncontrolled select: it seeds from `defaultValue` at mount. When a
          pick auto-submits, the server action refreshes this route with the
          persisted `currentSkillLevelId`; keying on that value remounts the
          select so it re-syncs to the saved level instead of falling back to
          its stale mounted state. The key only changes once the change is
          persisted, so it never disturbs the pick mid-interaction.
        */}
        <select
          key={currentSkillLevelId ?? 'none'}
          id={`skill-${membershipId}`}
          name="skillLevelId"
          defaultValue={currentSkillLevelId ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">{noneLabel}</option>
          {skillLevels.map((lvl) => (
            <option key={lvl.id} value={lvl.id}>{lvl.name}</option>
          ))}
        </select>
      </Field>
    </form>
  );
}
