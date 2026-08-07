// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The translation keys are asserted on directly (with interpolated values appended)
// rather than resolved through real message files — this test is about wiring, not copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./actions', () => ({
  addSkillLevelAction: vi.fn(),
  deleteSkillLevelAction: vi.fn(),
  renameSkillLevelAction: vi.fn(),
  reorderSkillLevelAction: vi.fn(),
}));

import { deleteSkillLevelAction } from './actions';
import { SkillLevelsEditor } from './skill-levels-editor';

const levels = [
  { id: 'a', name: 'Beginner', refs: { members: 0, boats: 0 } },
  { id: 'b', name: 'Advanced', refs: { members: 0, boats: 0 } },
];

const labels = {
  addPlaceholder: 'addPlaceholder',
  add: 'add',
  moveUp: 'moveUp',
  moveDown: 'moveDown',
  rename: 'rename',
  save: 'save',
  cancel: 'cancel',
  delete: 'delete',
  deleteConfirmYes: 'deleteConfirmYes',
  empty: 'empty',
};

const confirms = { a: 'confirm-a', b: 'confirm-b' };

describe('SkillLevelsEditor delete flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The shared-pending regression this task exists to fix: confirming and submitting
  // one row's delete must not disable another row's delete-confirm control while the
  // first deletion is still in flight (both rows share ONE hoisted useActionState).
  it("keeps another row's delete-confirm control enabled while one deletion is in flight", async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(deleteSkillLevelAction).mockImplementation(
      () => new Promise((r) => { resolve = r; }),
    );

    render(<SkillLevelsEditor slug="club" levels={levels} labels={labels} confirms={confirms} />);

    // Open row A's confirm view and submit its delete.
    fireEvent.click(screen.getAllByRole('button', { name: 'delete' })[0]);
    const confirmYesA = screen.getByRole('button', { name: 'deleteConfirmYes' });
    fireEvent.submit(confirmYesA.closest('form')!);

    await waitFor(() => expect(confirmYesA).toHaveAttribute('data-pending'));

    // While A's deletion is still in flight, open row B's confirm view. This
    // unmounts A's (still-pending) confirm form and mounts a fresh one for B.
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    const confirmYesB = screen.getByRole('button', { name: 'deleteConfirmYes' });

    expect(confirmYesB).not.toBeDisabled();
    expect(confirmYesB).not.toHaveAttribute('data-pending');

    resolve?.({ ok: true });
  });
});
