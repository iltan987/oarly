'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { ManageActionResult } from '../action-result';
import { assignSkillAction } from './actions';

const NONE_VALUE = 'none';

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
  const t = useTranslations('manage');
  const formRef = useRef<HTMLFormElement>(null);
  const skipNextAutoSubmit = useRef(true);
  const [value, setValue] = useState(currentSkillLevelId ?? NONE_VALUE);
  const [state, formAction] = useActionState<ManageActionResult | null, FormData>(
    assignSkillAction.bind(null, slug),
    null,
  );

  // Auto-submit after `value` (and the hidden input below) has actually
  // re-rendered — not synchronously inside onValueChange, where the hidden
  // input's DOM value would still be stale from before the state commits.
  useEffect(() => {
    if (skipNextAutoSubmit.current) {
      skipNextAutoSubmit.current = false;
      return;
    }
    formRef.current?.requestSubmit();
  }, [value]);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) toast.success(t('skillSaved'));
    else toast.error(t('actionError'));
  }, [state, t]);

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="membershipId" value={membershipId} />
      {/*
        shadcn/Base UI Select is controlled UI and does not serialize to
        FormData on its own — this hidden input is the source of truth for
        the submitted value. Base UI Select can't use an empty-string item
        value, so "no level" is represented as the "none" sentinel here and
        mapped back to '' for the server action.
      */}
      <input type="hidden" name="skillLevelId" value={value === NONE_VALUE ? '' : value} />
      <Field>
        <FieldLabel htmlFor={`skill-${membershipId}`} className="sr-only">{label}</FieldLabel>
        {/*
          Uncontrolled-from-the-server, controlled-in-the-browser: this
          remounts (via `key`) whenever the server-persisted value changes,
          so a stale pick never sticks after the revalidated page reloads it.
        */}
        <Select
          key={currentSkillLevelId ?? NONE_VALUE}
          defaultValue={currentSkillLevelId ?? NONE_VALUE}
          onValueChange={(next) => setValue(next as string)}
        >
          <SelectTrigger id={`skill-${membershipId}`} size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{noneLabel}</SelectItem>
            {skillLevels.map((lvl) => (
              <SelectItem key={lvl.id} value={lvl.id}>{lvl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </form>
  );
}
