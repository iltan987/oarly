/**
 * Shared result type for manage-area server actions. Each action returns this so its form
 * can drive `useActionState` + a sonner toast: `{ ok: true }` closes the form / shows
 * success, `{ ok: false }` shows an error. One definition here keeps the route action
 * modules from drifting apart.
 *
 * WHAT `{ ok: false }` DOES NOT DO is preserve the user's edits. This type used to claim it
 * did; it never has. React 19 resets an uncontrolled form after ANY completed form action,
 * refusal included — `<form action>` schedules the reset before the action even runs
 * (react-dom 19.2.8, `startHostTransition` -> `requestFormReset`) and it lands as a native
 * `.reset()` on the form node, so every `defaultValue` field snaps back. Measured in Chrome
 * against `/manage/profile`: same `<form>` node, a `reset` event fired on it, and a
 * 2001-character description replaced by the stored one.
 *
 * The fix, where it is worth having, is for the action to return the submitted values and
 * for the form to feed them back as the inputs' new `defaultValue` — React writes that to
 * the value attribute before the reset runs in the same commit, so the reset restores what
 * the user typed. No remount is involved; remounting also preserves the text but destroys
 * the focused node (measured: `document.activeElement` fell to `<body>`).
 *
 * WHICH FORMS NEED IT is not a question about this type. React's reset does not know what an
 * action returns — it fires for any `<form action={fn}>` — so the population to check is
 * defined by SHAPE: an UNCONTROLLED input inside a `<form action={…}>`. Both halves count,
 * and the second is the worse one:
 *
 *   - WITH a `defaultValue`, a reset REVERTS the field to the stored value; and
 *   - WITHOUT one, a reset WIPES it, because `form.reset()` restores a control to its value
 *     ATTRIBUTE and an input with no `defaultValue` has `''`.
 *
 * The first sweep for this only looked for `defaultValue` and therefore missed every form of
 * the second kind. Re-run over the whole app, both kinds:
 *
 *   ECHOED — a refusal reachable in ordinary use silently loses typed content, and the
 *   message does not necessarily name what it lost:
 *     - `manage/profile/profile-form.tsx`     reverts 5 fields, incl. a 2000-char description
 *     - `account/account-form.tsx`            reverts 6 fields
 *     - `manage/boats/boats-editor.tsx`       reverts 3; `minAttendance > seats`
 *     - `manage/schedule/window-form.tsx`     reverts 3; uneven tiling, overlap
 *     - `manage/policies/policies-form.tsx`   reverts 2; and see THE LINE below
 *     - `request-club/request-club-form.tsx`  WIPES 2; `slug_taken` names only the slug
 *     - `admin/clubs/new/page.tsx`            WIPES 3; `slug_taken` / `owner_not_found`
 *
 *   LEFT, with the reason each is actually left for:
 *     - `manage/skill-levels`'s add form and `manage/profile`'s add-social form — both WIPE
 *       (no `defaultValue`), and neither is left because they clear on success: that is the
 *       success path, and a refusal here toasts the generic `actionError`, naming nothing.
 *       They are left because what is lost is one short identifier (a <=40-char level name)
 *       or two (a platform and a handle), typed seconds earlier and retyped in seconds.
 *     - `manage/skill-levels`'s rename form — reverts one <=40-char name, still on screen.
 *     - `admin/requests/decision-buttons.tsx` — its `note` Textarea would be wiped, but the
 *       reset is not what removes it: the effect calls `setPendingDecision(null)` on EVERY
 *       resolved state, so the `{pendingDecision && <form>}` guard unmounts the dialog and
 *       the note with it. Both refusals also make the note moot — `note_required` means it
 *       was empty, and `not_pending` means someone else already decided the request, so
 *       there is nothing to resubmit.
 *
 *   CHECKED AND NOT AT RISK, recorded so the next sweep does not redo the work:
 *     - `manage/bookings/bookings-roster.tsx`'s owner-add form — every field is a hidden
 *       input driven by React state, and the member search box is both controlled AND
 *       portalled out of the form by its Popover, so `form.reset()` never reaches it.
 *     - `admin/clubs/[id]/transfer-owner.tsx` — the search box is OUTSIDE the `<form>`,
 *       which holds one hidden input.
 *     - `manage/members/skill-level-select.tsx` — the submitted value is a hidden input
 *       driven by React state, which a reset does not touch.
 *     - `manage/members/page.tsx` — `<form method="get">` with no function action, so
 *       React's reset never runs at all.
 *     - hidden-input-only forms: `setBoatActiveAction`, `approveMemberAction`,
 *       `rejectMemberAction`, `deleteWindowAction`, `setOverrideAction`,
 *       `clearOverrideAction`, `reorderSkillLevelAction`, `deleteSkillLevelAction`,
 *       `removeSocialAction`, `admin/users/admin-toggle.tsx`,
 *       `admin/club-status-button.tsx`, `book/book-calendar.tsx`,
 *       `components/confirm-dialog.tsx`, `join/join-form.tsx`.
 *
 * THE LINE, and it is not a field count — `policies-form.tsx` is what corrected that. Its
 * reachable refusal is `invalid_input` (switch booking-open to "lead" mode, leave the days
 * blank, and the schema's refine rejects it), whose message is the GENERIC one and names no
 * field — while the reset also reverted `waitlistCapacity`, which the owner may have changed
 * in the same save. One field, silently, with the error naming nothing. So: echo where a
 * refusal reachable in ORDINARY use can lose typed content the user is not told about. Add
 * such a field to any form above and the action owes an echo.
 */
export type ManageActionResult = { ok: true } | { ok: false };
