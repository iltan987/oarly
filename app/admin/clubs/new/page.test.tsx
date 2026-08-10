// @vitest-environment jsdom
/**
 * The admin twin of `app/request-club/request-club-form.test.tsx`, and the same defect: three
 * inputs with no `defaultValue`, so React 19's post-action reset WIPED them rather than
 * reverting them (`form.reset()` restores a control to its value attribute, which without a
 * `defaultValue` is `''`).
 *
 * Echoed rather than left-with-a-reason despite being admin-only, because both refusals are
 * ordinary rather than crafted: `slug_taken` for a slug already in use, and `owner_not_found`
 * for an owner who has not signed up or whose address was mistyped. Each names ONE field and
 * silently emptied the other two — one of which is an email address.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./actions', () => ({ createClubAction: vi.fn() }));

import { createClubAction, type CreateClubState } from './actions';
import NewClubPage from './page';

/** A refusal that echoes what was submitted, exactly as `createClubAction` does. */
function refuseEchoingSubmission(errors: Record<string, string>) {
  vi.mocked(createClubAction).mockImplementation(async (_prev, formData): Promise<CreateClubState> => ({
    errors,
    values: {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      ownerEmail: String(formData.get('ownerEmail') ?? ''),
    },
  }));
}

async function submitAndSettle() {
  await act(async () => {
    const form = document.querySelector('form');
    if (!form) throw new Error('new-club form not found');
    fireEvent.submit(form);
  });
}

function fillIn() {
  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Bebek Kürek Kulübü' } });
  fireEvent.change(screen.getByLabelText('slug'), { target: { value: 'bebek' } });
  fireEvent.change(screen.getByLabelText('ownerEmail'), { target: { value: 'owner@example.com' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClubAction).mockResolvedValue({});
});

describe('NewClubPage', () => {
  it('renders real DOM before anything else is asserted about it', () => {
    const { container } = render(<NewClubPage />);
    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByLabelText('ownerEmail')).toHaveValue('');
  });

  it('keeps all three fields when a taken slug is refused', async () => {
    refuseEchoingSubmission({ slug: 'errorSlugTaken' });
    render(<NewClubPage />);

    fillIn();
    await submitAndSettle();

    expect(screen.getByText('errorSlugTaken')).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Bebek Kürek Kulübü');
    expect(screen.getByLabelText('slug')).toHaveValue('bebek');
    expect(screen.getByLabelText('ownerEmail')).toHaveValue('owner@example.com');
  });

  // The refusal that names the OTHER end of the form: the slug and name must survive it too.
  it('keeps all three fields when the owner is not found', async () => {
    refuseEchoingSubmission({ ownerEmail: 'errorOwnerNotFound' });
    render(<NewClubPage />);

    fillIn();
    await submitAndSettle();

    expect(screen.getByText('errorOwnerNotFound')).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Bebek Kürek Kulübü');
    expect(screen.getByLabelText('slug')).toHaveValue('bebek');
    expect(screen.getByLabelText('ownerEmail')).toHaveValue('owner@example.com');
  });

  it('keeps the same form node on a refusal, so focus is not thrown away', async () => {
    refuseEchoingSubmission({ slug: 'errorSlugTaken' });
    const { container } = render(<NewClubPage />);
    const before = container.querySelector('form');
    const field = screen.getByLabelText('ownerEmail');

    fillIn();
    await submitAndSettle();

    expect(screen.getByLabelText('ownerEmail')).toBe(field);
    expect(container.querySelector('form')).toBe(before);
  });
});
