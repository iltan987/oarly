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
        <select
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
