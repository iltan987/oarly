// Shared result type for manage-area server actions. Each action returns this
// so its form can drive `useActionState` + a sonner toast: `{ ok: true }` closes
// the form / shows success, `{ ok: false }` keeps the edits and shows an error.
// One definition here keeps the four route action modules from drifting.
export type ManageActionResult = { ok: true } | { ok: false };
