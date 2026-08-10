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
 * the user typed. Two actions do that, and they carry their own wider result types rather
 * than widening this one:
 *   - `profile/actions.ts` — `ProfileSaveResult`
 *   - `boats/actions.ts`   — `BoatSaveResult`
 * (`app/account/actions.ts` does the same outside the manage area.)
 *
 * WHERE THE LINE IS, so the rest is a decision and not an oversight: the echo is applied
 * where a refusal reachable in ORDINARY use destroys more than one field of typed content.
 * Everything else returning this type either submits nothing the user typed, or exactly one
 * short identifier that is still on screen to retype:
 *   - hidden-input only, nothing to lose: `setBoatActiveAction`, `approveMemberAction`,
 *     `rejectMemberAction`, `assignSkillAction`, `deleteWindowAction`, `setOverrideAction`,
 *     `clearOverrideAction`, `reorderSkillLevelAction`, `deleteSkillLevelAction`,
 *     `removeSocialAction`.
 *   - one short name, deliberately left: `addSkillLevelAction` / `renameSkillLevelAction`
 *     (a <=40-character level name) and `addSocialAction` (a platform and a handle, which
 *     the form already clears on success by design).
 * Add a field long enough that retyping it is real work, and the action owes an echo.
 */
export type ManageActionResult = { ok: true } | { ok: false };
