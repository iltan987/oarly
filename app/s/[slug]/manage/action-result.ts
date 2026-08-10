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
 * defined by SHAPE: an uncontrolled `defaultValue` input inside a `<form action={…}>`.
 * Enumerated that way, across the whole app:
 *
 *   ECHOED (a refusal reachable in ordinary use silently reverts typed content, and the
 *   message does not necessarily name what it reverted):
 *     - `manage/profile/profile-form.tsx`      `ProfileSaveResult`   5 fields, incl. a 2000-char description
 *     - `manage/boats/boats-editor.tsx`        `BoatSaveResult`      3 fields; `minAttendance > seats`
 *     - `manage/schedule/window-form.tsx`      `WindowFormState`     3 fields; uneven tiling, overlap
 *     - `manage/policies/policies-form.tsx`    `PoliciesState`       2 fields; blank lead days
 *     - `app/account/account-form.tsx`         `AccountActionResult` 6 fields (outside the manage area)
 *
 *   LEFT, deliberately:
 *     - `manage/skill-levels/skill-levels-editor.tsx` — one <=40-char level name, and the add
 *       form clears itself on success by design.
 *     - `manage/profile`'s add-social form — a platform and a handle, both short, likewise
 *       cleared on success.
 *     - `manage/members/skill-level-select.tsx` — the submitted value is a hidden input driven
 *       by React state, which a reset does not touch. Nothing typed, nothing to lose.
 *     - `manage/members/page.tsx` — `<form method="get">` with no function action, so React's
 *       reset never runs.
 *     - every form here whose only fields are hidden inputs: `setBoatActiveAction`,
 *       `approveMemberAction`, `rejectMemberAction`, `assignSkillAction`,
 *       `deleteWindowAction`, `setOverrideAction`, `clearOverrideAction`,
 *       `reorderSkillLevelAction`, `deleteSkillLevelAction`, `removeSocialAction`.
 *
 * THE LINE, and it is not a field count — `policies-form.tsx` is what corrected that. Its
 * reachable refusal is `invalid_input` (switch booking-open to "lead" mode, leave the days
 * blank, and the schema's refine rejects it), whose message is the GENERIC one and names no
 * field — while the reset also reverted `waitlistCapacity`, which the owner may have changed
 * in the same save. One field, silently, with the error naming nothing. So: echo where a
 * refusal reachable in ORDINARY use can revert typed content the user is not told about. Add
 * such a field to any form above and the action owes an echo.
 */
export type ManageActionResult = { ok: true } | { ok: false };
