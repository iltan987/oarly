// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ assignSkillAction: vi.fn() }));

import { SkillLevelSelect } from './skill-level-select';

const LEVELS = [{ id: 'l1', name: 'Başlangıç' }, { id: 'l2', name: 'Orta' }];

function renderSelect(currentSkillLevelId: string | null = null) {
  render(
    <SkillLevelSelect
      slug="demo"
      membershipId="m1"
      skillLevels={LEVELS}
      currentSkillLevelId={currentSkillLevelId}
      label="skillLevel"
      noneLabel="none"
    />,
  );
  const trigger = document.getElementById('skill-m1');
  if (!trigger) throw new Error('trigger not found');
  return trigger;
}

describe('SkillLevelSelect', () => {
  /**
   * `lg:w-full` is half of what the roster's `12rem` grid column buys, and it was listed
   * in this task's report as "pinned as a class string" when nothing referenced it —
   * deleting it left the whole suite green. Without it the trigger stays `w-36` (9rem)
   * inside a 12rem cell: the left edges still line up, the RIGHT edges do not, and the
   * column reads as ragged from the side the eye actually lands on.
   *
   * Asserted on the element found BY ID rather than by class selector: `SelectTrigger`
   * wraps Base UI primitives that carry their own utility classes, and a `.w-36` query
   * would happily match one of them and pass with this class deleted.
   *
   * Both halves are asserted, because below `lg:` the row is a wrapping stack where a
   * full-width trigger would swallow the row.
   */
  it('is w-36 below lg and fills its grid column at lg', () => {
    const trigger = renderSelect();
    expect(trigger).toHaveClass('w-36');
    expect(trigger).toHaveClass('lg:w-full');
  });

  it('labels the control for a screen reader without showing a label per row', () => {
    const trigger = renderSelect();
    expect(trigger).toHaveAccessibleName('skillLevel');
    // 25 visible "Seviye" labels down a 25-row roster is the density this task removed.
    expect(screen.getByText('skillLevel')).toHaveClass('sr-only');
  });

  /**
   * Base UI's Select cannot use an empty-string item value, so "no level" travels as the
   * `none` sentinel — and the hidden input is what maps it back to `''`, which is what
   * `assignSkillAction` accepts as "clear this member's level". Submitting the sentinel
   * verbatim would fail `isUuid` and return `{ ok: false }`, i.e. an error toast for a
   * legitimate action.
   */
  it('submits an empty string, not the none sentinel, for a member with no level', () => {
    renderSelect(null);
    expect(document.querySelector('input[name="skillLevelId"]')).toHaveValue('');
    expect(document.querySelector('input[name="membershipId"]')).toHaveValue('m1');
  });

  it('submits the level id for a member who has one', () => {
    renderSelect('l2');
    expect(document.querySelector('input[name="skillLevelId"]')).toHaveValue('l2');
  });
});
