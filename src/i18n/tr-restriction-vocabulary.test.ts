import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A pause and a suspension must never be the same word.
 *
 * Modelled on `tr-role-nouns.test.ts`, for the same reason and against the same failure
 * mode: every component test in this repo mocks next-intl and asserts on KEY NAMES, so
 * not one of them can see the copy. Two message keys that quietly collapse into one word
 * are invisible to `pnpm test` and to a diff reviewer who sees two strings that "mean the
 * same thing" and tidies one away.
 *
 * The distinction being defended:
 *
 * - **Duraklatıldı** (paused) — the media-player sense. Universally read as "it will
 *   resume by itself", with no disciplinary charge in it. A member serving a 48-hour
 *   cooling-off is in this state.
 * - **Askıda** (suspended) — `askı` is the vocabulary of a judgement passed on a person.
 *   Reserved for the permanent penalty, which is the only case that actually is one.
 *
 * The rejected phrasing, and the reason this file exists at all: the product owner read
 * `booking.reasons.banned` — *"Geçici olarak askıya alındı"* ("temporarily suspended") —
 * on a two-day cooling-off and understood it as "they banned me". It keeps `askı`, so it
 * keeps the accusation, while `geçici` ("temporary") does nothing to soften it. Any
 * regression to that framing has to fail here, not in a review.
 *
 * Turkish is the app default; English is checked only for the same collapse, because the
 * word pair carries the distinction there too and a swap would sail past a TR-only guard.
 */

type Node = string | { [k: string]: Node };

function load(locale: 'tr' | 'en'): Record<string, Node> {
  const path = fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Node>;
}

/** Every leaf string in the catalog, with its dot path — for the whole-catalog sweeps. */
function leaves(node: Node, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

const tr = load('tr');
const en = load('en');
const trRestriction = tr.restriction as Record<string, string>;
const enRestriction = en.restriction as Record<string, string>;

/** `askı` softens to `askı-`/`ask-` under suffixes: askıya, askıda, askıya alındı. */
const SUSPENSION_ROOT = /ask[ıi]/i;
/** `durakla-` covers duraklatıldı, duraklatma, duraklatılan. */
const PAUSE_ROOT = /durakla/i;

/** The keys this file reasons about. Named so a RENAME cannot make the rest pass vacuously. */
const KEYS = [
  'pausedTitle',
  'pausedUntil',
  'suspendedTitle',
  'suspendedBody',
  'causeNoShow',
  'causeNoShowUndated',
  'causeOther',
  'contact',
  'callClub',
] as const;

describe('the restriction vocabulary', () => {
  it('still defines every key this file names, in both locales', () => {
    // First, and separately: a renamed key would otherwise make every check below
    // compare `undefined` against a regex and pass without asserting anything.
    expect(KEYS.filter((k) => typeof trRestriction?.[k] !== 'string')).toEqual([]);
    expect(KEYS.filter((k) => typeof enRestriction?.[k] !== 'string')).toEqual([]);
  });

  it('names a pause with the pause word and never with the suspension word', () => {
    expect(trRestriction.pausedTitle).toMatch(PAUSE_ROOT);
    expect(trRestriction.pausedTitle).not.toMatch(SUSPENSION_ROOT);
    // The sentence under the title has to hold the line too — a title that says
    // "Duraklatıldı" above a body that says "askıya alındı" is still an accusation.
    expect(trRestriction.pausedUntil).not.toMatch(SUSPENSION_ROOT);
  });

  it('names a suspension with the suspension word and never with the pause word', () => {
    expect(trRestriction.suspendedTitle).toMatch(SUSPENSION_ROOT);
    expect(trRestriction.suspendedTitle).not.toMatch(PAUSE_ROOT);
  });

  /**
   * The collapse itself, stated directly: two states, two words. This is the assertion
   * that fails if someone deletes one key and points both call sites at the other, which
   * neither of the two tests above would catch on its own.
   */
  it('never lets the two states share a word', () => {
    expect(trRestriction.pausedTitle).not.toBe(trRestriction.suspendedTitle);
    expect(enRestriction.pausedTitle).not.toBe(enRestriction.suspendedTitle);
    // English draws the same distinction and must not borrow "suspend" for the pause.
    expect(enRestriction.pausedTitle).not.toMatch(/suspend/i);
    expect(enRestriction.pausedUntil).not.toMatch(/suspend/i);
    expect(enRestriction.suspendedTitle).toMatch(/suspend/i);
  });

  /**
   * The exact phrasing that was rejected, swept over the WHOLE catalog rather than over
   * the `restriction` group. The group is new and nobody will regress it by accident; the
   * realistic regression is somebody re-adding "geçici olarak askıya alındı" to
   * `booking.reasons.banned`, where it lived until this task, or to a new key elsewhere.
   */
  it('says "geçici olarak askıya" nowhere in the Turkish catalog', () => {
    const offenders = leaves(tr)
      .filter(([, value]) => /geçici olarak ask[ıi]/i.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /**
   * Both placeholders, in both locales, because the TIME is the load-bearing half and a
   * translator dropping it produces a grammatical sentence that is simply less useful:
   * "12 Ağustos günü rezervasyon yapabilirsin" reads as "some time that day". The parity
   * test compares argument names between locales, so a `{time}` dropped from BOTH would
   * pass there — this is what catches it.
   */
  it('tells a paused member the time as well as the date', () => {
    for (const message of [trRestriction.pausedUntil, enRestriction.pausedUntil]) {
      expect(message).toContain('{date}');
      expect(message).toContain('{time}');
    }
  });

  /**
   * `causeNoShow` reuses the transactional email's vocabulary on purpose: a member who
   * got `emails.booking.noShow` ("Kulüp bu seansa katılmadığınızı kaydetti") and then
   * opens the app must read the same event described the same way, or they have to work
   * out for themselves that the two are about one absence.
   */
  it('describes the cause with the same verb as the no-show email', () => {
    const email = (tr.emails as Record<string, Record<string, Record<string, string>>>).booking.noShow.intro;
    expect(email).toMatch(/katılmadığını/i);
    expect(trRestriction.causeNoShow).toMatch(/katılmadığını/i);
    expect(trRestriction.causeNoShowUndated).toMatch(/katılmadığını/i);
  });
});

/**
 * `booking.cancelledBy.*` renders on `/bookings` directly beneath the restriction card
 * above, so it inherits that card's register or it contradicts it: an explanation of what
 * the club RECORDED, never a verdict about the member. Same reason this file exists at
 * all — every component test mocks next-intl and asserts on key names, so not one of them
 * can see this copy.
 */
describe('the cancellation sub-line vocabulary', () => {
  const trBooking = tr.booking as Record<string, Record<string, string>>;
  const enBooking = en.booking as Record<string, Record<string, string>>;

  it('still defines both keys in both locales', () => {
    // First and separately: a rename would leave every check below comparing `undefined`
    // against a regex, and passing without asserting anything.
    for (const catalog of [trBooking, enBooking]) {
      expect(typeof catalog.cancelledBy?.penalty).toBe('string');
      expect(typeof catalog.cancelledBy?.owner).toBe('string');
    }
  });

  /**
   * The register's load-bearing half, and the one the first draft of this copy dropped.
   *
   * "KULÜP katılmadığını kaydettiği için" names the club as the author of the record.
   * The agentless passive it replaced — "Katılmadığın kaydedildiği için" — reported the
   * absence as recorded but by nobody, which leaves the app itself sounding like the one
   * asserting it. Task 6's `restriction` group names the club in every cause string, the
   * `owner` line below names it, and the ENGLISH penalty line already named it ("the club
   * recorded") — so Turkish, the app default, was the single locale drifting.
   *
   * Asserted on both keys in both locales, because "the club is named" is the rule, not a
   * property of one sentence.
   */
  it('names the club as the author, in every reason and both locales', () => {
    expect(trBooking.cancelledBy.penalty).toMatch(/kulüp/i);
    expect(trBooking.cancelledBy.owner).toMatch(/kulüp/i);
    expect(enBooking.cancelledBy.penalty).toMatch(/the club/i);
    expect(enBooking.cancelledBy.owner).toMatch(/the club/i);
  });

  /**
   * And what the club did was RECORD an absence, not find one. `kayd-` covers
   * kaydetti/kaydettiği/kaydedildi — what is defended is the record framing, whichever
   * way the grammar turns. The shared `katılmadığını` is the same verb the restriction
   * card directly above this line uses, and the same one the no-show email used before
   * that: a member reading all three must not have to work out that they are one event.
   */
  it('describes the absence as something recorded, in the words of the card above it', () => {
    expect(trBooking.cancelledBy.penalty).toMatch(/kayd/i);
    expect(trBooking.cancelledBy.penalty).toMatch(/katılmadığını/i);
    expect(enBooking.cancelledBy.penalty).toMatch(/recorded/i);
  });

  /**
   * `askı` is the vocabulary of a judgement passed on a person, reserved for the permanent
   * penalty. This line is about ONE SEAT; the member's standing is the card above's
   * subject, and borrowing its heaviest word here says something the seat cannot support.
   */
  it('never reaches for the suspension word to describe a lost seat', () => {
    expect(trBooking.cancelledBy.penalty).not.toMatch(SUSPENSION_ROOT);
    expect(trBooking.cancelledBy.owner).not.toMatch(SUSPENSION_ROOT);
  });

  /**
   * Three distinct strings, and the realistic regression is a collapse: the two reasons
   * tidied into one, or either one reduced back to the pill's bare "İptal edildi" — which
   * would restore precisely the ambiguity this task removed while leaving both the
   * component test and the parity test green.
   */
  it('never lets the two reasons, or a reason and the pill, share a string', () => {
    const pill = tr.booking as unknown as Record<string, string>;
    expect(trBooking.cancelledBy.penalty).not.toBe(trBooking.cancelledBy.owner);
    expect(trBooking.cancelledBy.penalty).not.toBe(pill.cancelled);
    expect(trBooking.cancelledBy.owner).not.toBe(pill.cancelled);
  });

  /**
   * The deliberate silence, guarded where a copywriter would look. `'member'` and `null`
   * render nothing on purpose: for a historical row we do not know who ended it, and
   * "you cancelled this" about what may have been an owner removal is worse than saying
   * nothing. A `cancelledBy.member` key is how that decision gets undone by accident —
   * it looks like the obvious missing third case.
   */
  it('offers no wording for a self-cancellation, which must stay silent', () => {
    expect(trBooking.cancelledBy.member).toBeUndefined();
    expect(enBooking.cancelledBy.member).toBeUndefined();
  });
});

/**
 * Task 8's additions to the same page, guarded for the same reason as everything above:
 * every component test in this repo mocks next-intl and asserts on KEY NAMES, so nothing
 * in `pnpm test` can see a word of this copy. `bookings-list.test.tsx` proves the dismiss
 * control is not the trigger control; only this file can prove it does not SAY the same
 * thing as the trigger, or that the body still explains where the seat goes.
 */
describe('the self-cancellation confirm vocabulary', () => {
  const trBooking = tr.booking as Record<string, string>;
  const enBooking = en.booking as Record<string, string>;

  const CONFIRM_KEYS = ['confirmCancelTitle', 'confirmCancelBody', 'confirmCancelCta', 'confirmCancelKeep'] as const;

  it('still defines every confirm key this file names, in both locales', () => {
    // First and separately: a rename leaves every check below testing `undefined` against
    // a regex — passing while asserting nothing.
    expect(CONFIRM_KEYS.filter((k) => typeof trBooking[k] !== 'string')).toEqual([]);
    expect(CONFIRM_KEYS.filter((k) => typeof enBooking[k] !== 'string')).toEqual([]);
  });

  /**
   * Three controls appear in this flow — the row trigger (`cancel`), the dialog's dismiss
   * and the dialog's confirm — and no two of them may read alike. `booking.cancel` is
   * "Vazgeç", which is ALSO the dismiss label of the /book confirm dialog
   * (`book-calendar.tsx:232`), so reaching for it here is the obvious mistake: it produces
   * "Vazgeç / Vazgeç" and the second decision stops being one
   * (`decision-buttons.tsx:80-81`).
   */
  it('gives the trigger, the dismiss and the confirm three different words', () => {
    for (const catalog of [trBooking, enBooking]) {
      expect(catalog.confirmCancelKeep).not.toBe(catalog.cancel);
      expect(catalog.confirmCancelCta).not.toBe(catalog.cancel);
      expect(catalog.confirmCancelKeep).not.toBe(catalog.confirmCancelCta);
    }
  });

  /**
   * And the dismiss must say what it DOES — keep the seat — rather than "never mind". This
   * is the half a rename cannot fake: a dismiss reading "Kapat"/"Close" satisfies the
   * distinctness test above and still leaves the member guessing which button abandons
   * their seat.
   */
  it('names the safe choice after its consequence, not after dismissing a dialog', () => {
    expect(trBooking.confirmCancelKeep).toMatch(/koru/i);
    expect(enBooking.confirmCancelKeep).toMatch(/keep/i);
  });

  /**
   * The body is the whole justification for the extra tap. `cancelBooking` calls
   * `applySeating` in the same transaction, so on a full session the waitlist promotes on
   * commit — a body reduced to "Emin misin?" / "Are you sure?" adds friction and tells the
   * member nothing they did not already know.
   */
  it('says where the seat actually goes', () => {
    expect(trBooking.confirmCancelBody).toMatch(/bekleme listes/i);
    expect(enBooking.confirmCancelBody).toMatch(/waiting|waitlist/i);
  });

  /**
   * `askı` is the vocabulary of a judgement passed on a person, and this dialog is about a
   * member's OWN voluntary act. Borrowing the restriction card's heaviest word here would
   * make a member's own decision read as a sanction — the same rule the cancellation
   * sub-line above obeys, applied to the one string addressed TO the member.
   */
  it('never frames the member\'s own choice with the suspension word', () => {
    for (const key of CONFIRM_KEYS) expect(trBooking[key]).not.toMatch(SUSPENSION_ROOT);
  });
});

/**
 * Both `/bookings` sections used to render ONE string, `booking.none` ("Henüz bir şey
 * yok."), under two headings that mean opposite things. The parity test compares key sets
 * between locales and so cannot see a collapse back to one shared sentence, and the
 * component test asserts on key names and cannot see two keys holding identical copy.
 */
describe('the empty-state vocabulary', () => {
  const trBooking = tr.booking as Record<string, string>;
  const enBooking = en.booking as Record<string, string>;

  const EMPTY_KEYS = [
    'emptyUpcomingTitle', 'emptyUpcomingBody', 'emptyUpcomingCta',
    'emptyPastTitle', 'emptyPastBody', 'noSessionsHint',
  ] as const;

  it('still defines every empty-state key this file names, in both locales', () => {
    expect(EMPTY_KEYS.filter((k) => typeof trBooking[k] !== 'string')).toEqual([]);
    expect(EMPTY_KEYS.filter((k) => typeof enBooking[k] !== 'string')).toEqual([]);
  });

  it('never lets the two sections share a sentence', () => {
    for (const catalog of [trBooking, enBooking]) {
      expect(catalog.emptyUpcomingTitle).not.toBe(catalog.emptyPastTitle);
      expect(catalog.emptyUpcomingBody).not.toBe(catalog.emptyPastBody);
    }
  });

  /**
   * The orphan, asserted gone. `booking.none` has no call site left, and the parity test
   * compares the two catalogs to EACH OTHER — a dead key present in both is invisible to
   * it forever. Re-adding it is how the collapsed empty state comes back.
   */
  it('no longer carries the one-string empty state it replaced', () => {
    expect(trBooking.none).toBeUndefined();
    expect(enBooking.none).toBeUndefined();
  });
});
