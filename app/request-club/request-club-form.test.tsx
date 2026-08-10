// @vitest-environment jsdom
/**
 * A refused club request must not empty the form.
 *
 * This form is the WORSE half of the shape `app/s/[slug]/manage/action-result.ts` records.
 * Its inputs carry no `defaultValue`, and `form.reset()` restores a control to its value
 * ATTRIBUTE — which without a `defaultValue` is `''`. So React 19's post-action reset did not
 * revert these fields to a stored value, it WIPED them.
 *
 * The refusal is the ordinary one: `slug_taken` is what a prospective owner gets for picking
 * a club name someone already has, and it names only the SLUG — so the club name they typed
 * disappeared with nothing said about it. This is a public page and the first thing anyone
 * ever submits to this product.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./actions', () => ({ requestClubAction: vi.fn() }));

import { requestClubAction, type RequestClubState } from './actions';
import { RequestClubForm } from './request-club-form';

/** A refusal that echoes what was submitted, exactly as `requestClubAction` does. */
function refuseEchoingSubmission(errors: Record<string, string>) {
  vi.mocked(requestClubAction).mockImplementation(async (_prev, formData): Promise<RequestClubState> => ({
    errors,
    values: {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
    },
  }));
}

/**
 * Submit and wait for the result to be COMMITTED. The fields already hold the typed text the
 * moment it is typed, so `waitFor(() => expect(field).toHaveValue(…))` passes before the
 * action has even been called — it would go green with the echo removed.
 */
async function submitAndSettle() {
  await act(async () => {
    const form = document.querySelector('form');
    if (!form) throw new Error('request-club form not found');
    fireEvent.submit(form);
  });
}

function fillIn() {
  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Bebek Kürek Kulübü' } });
  fireEvent.change(screen.getByLabelText('slug'), { target: { value: 'bebek' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requestClubAction).mockResolvedValue({});
});

describe('RequestClubForm', () => {
  it('renders real DOM before anything else is asserted about it', () => {
    const { container } = render(<RequestClubForm />);
    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByLabelText('name')).toHaveValue('');
  });

  /**
   * The whole point: the error names the slug, and the NAME — which nothing complained
   * about — must still be there. Remove the echo and it comes back `''`.
   */
  it('keeps both fields when a taken slug is refused, including the one not at fault', async () => {
    refuseEchoingSubmission({ slug: 'errorSlugTaken' });
    render(<RequestClubForm />);

    fillIn();
    await submitAndSettle();

    expect(screen.getByText('errorSlugTaken')).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Bebek Kürek Kulübü');
    expect(screen.getByLabelText('slug')).toHaveValue('bebek');
  });

  // The rate-limited refusal is form-level and names no field at all, so it is the case
  // where an emptied form is least explicable.
  it('keeps both fields when the refusal names no field at all', async () => {
    refuseEchoingSubmission({ form: 'errorTooManyRequests' });
    render(<RequestClubForm />);

    fillIn();
    await submitAndSettle();

    expect(screen.getByText('errorTooManyRequests')).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Bebek Kürek Kulübü');
    expect(screen.getByLabelText('slug')).toHaveValue('bebek');
  });

  // Untrimmed, so the visitor gets back the characters they have in front of them rather
  // than the normalised form the schema parses.
  it('hands back what was typed, not the normalised form', async () => {
    refuseEchoingSubmission({ slug: 'errorSlugInvalid' });
    render(<RequestClubForm />);

    fireEvent.change(screen.getByLabelText('name'), { target: { value: '  Bebek  ' } });
    fireEvent.change(screen.getByLabelText('slug'), { target: { value: 'Bebek Kulup' } });
    await submitAndSettle();

    expect(screen.getByLabelText('name')).toHaveValue('  Bebek  ');
    expect(screen.getByLabelText('slug')).toHaveValue('Bebek Kulup');
  });

  // No remount, for the reason the other forms record: it would preserve the values too,
  // and cost the focused node.
  it('keeps the same form node on a refusal, so focus is not thrown away', async () => {
    refuseEchoingSubmission({ slug: 'errorSlugTaken' });
    const { container } = render(<RequestClubForm />);
    const before = container.querySelector('form');
    const field = screen.getByLabelText('name');

    fillIn();
    await submitAndSettle();

    expect(screen.getByLabelText('name')).toBe(field);
    expect(container.querySelector('form')).toBe(before);
  });
});
