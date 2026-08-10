import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A member is addressed as **sen**. Never as **siz**.
 *
 * The house register, honoured by every string `restriction.*`, `account.*` and `home.*`
 * has ever carried: the member is spoken to informally, the club owner formally. Thirteen
 * strings predated that rule and still said `siz`, and the sharpest pair sat two sentences
 * apart inside ONE dialog on /bookings — the confirm asked *"Yerini bırakmak istiyor
 * musun?"* (sen) and its own failure toast, `booking.cancelErrors.generic`, answered
 * *"Lütfen tekrar deneyin"* (siz). One flow, one member, two people talking to them.
 *
 * Guarded here for the reason `tr-role-nouns.test.ts` and `tr-restriction-vocabulary.test.ts`
 * give and this file inherits wholesale: every component test in this repo mocks next-intl
 * and asserts on KEY NAMES, so not one of them can see a word of this copy.
 * `messages-parity.test.ts` compares the two catalogs to EACH OTHER, so it is blind to a
 * Turkish string's register by construction — English has one second person, and the
 * English half of every pair below is unchanged and correct.
 *
 * What this file does NOT overlap: the other two guards are about WHICH WORD names a
 * thing (`yönetici` vs `kulüp sahibi`; `askı` vs `durakla` vs `yasak`), and the roster
 * test at the bottom of `members-roster.test.tsx` is about an accessible name containing
 * its visible label. None of them can see a person being addressed in the wrong register,
 * and this one cannot see any of theirs.
 */

type Node = string | { [k: string]: Node };

function load(): Record<string, Node> {
  const path = fileURLToPath(new URL('../../messages/tr.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Node>;
}

function leaves(node: Node, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

/**
 * The namespaces this file is scoped to, and the scope is the whole design.
 *
 * Every one of these is read ONLY by a member (or by a person who has no role yet, which
 * is the same voice): the landing page, the club's public page and join flow, the
 * restriction card, the account page, the sign-in/sign-up pages, and the two booking
 * surfaces. Each was audited string by string when this guard was written.
 *
 * Deliberately absent, and each for a reason that would otherwise get this file deleted:
 *
 * - `manage.*` and `admin.*` — an owner and a platform admin are addressed formally ON
 *   PURPOSE. A sweep that covers them fires on correct copy on its first run, and a guard
 *   that cries wolf is removed by the next person to touch the catalog. `owners are
 *   formal` is asserted positively at the bottom of this file so the omission reads as a
 *   decision rather than an oversight.
 * - `common.*` — shared chrome. `common.loadError`/`common.retry` render inside the
 *   console's error boundary as readily as on /book, so a future formal string there is
 *   legitimate and this guard has no way to tell. It carries zero formal markers today;
 *   that is left as a fact, not enforced as a rule.
 * - `emails.*` — a separate channel with its own settled register, and one that does not
 *   follow this rule at all: the six booking templates are uniformly formal
 *   ("Rezervasyonunuz alındı") while `clubApproved`/`clubRejected`, which go to an OWNER,
 *   are informal. Flipping a transactional email is a decision about the channel, not a
 *   leftover from before the rule, and it is not this task's.
 * - `requestClub.*`, `notFound.*`, `unavailable.*`, `privacy.*` — no second person in any
 *   of them to be right or wrong about.
 */
const MEMBER_NAMESPACES = ['home', 'club', 'join', 'restriction', 'auth', 'account', 'booking'] as const;

/** The audience this file exists to keep formal — the other half of the same rule. */
const OWNER_NAMESPACES = ['manage', 'admin'] as const;

/**
 * Turkish marks the formal second person in three ways, and only two of them can be found
 * by shape alone.
 *
 * 1. The 2nd-person-plural suffix: `-iniz/-ınız/-unuz/-ünüz` (your, formal —
 *    "rezervasyonunuz"), the verb ending `-siniz/-sınız/-sunuz/-sünüz` ("yapabilirsiniz"),
 *    and the past `-dınız/-diniz` ("yaptınız"). After a vowel it contracts to
 *    `-nız/-niz/-nuz/-nüz` ("kartınız"). Unambiguous — nothing else in the language ends
 *    that way — apart from a handful of ordinary words that happen to, which are named
 *    below rather than left to produce a false positive on `henüz`.
 *
 *    The trailing group is not optional decoration: Turkish stacks a case ending on top of
 *    the possessive, so the marker is very often not word-final. "E-posta adresinizi
 *    doğrulayın" carries the accusative, "rezervasyonunuzu iptal ettik" the same, and a
 *    pattern anchored straight to a word boundary sees neither. The allow-list is matched
 *    against the stem-plus-suffix capture rather than the whole word, so `henüz` stays
 *    exempt whatever follows it.
 */
const FORMAL_SUFFIX = /(\w*?(?:[ıiuü]n[ıiuü]z|n[ıiuü]z))(?:[ıiuü]|[ae]|[dt][ae]n?|[ıiuü]n|l[ae]|yl[ae])?(?=[\s.,;:!?"'’)\-–—]|$)/g;

/**
 * Ordinary words ending in `-nız/-niz/-nuz/-nüz` that carry no second person at all.
 * Listed, because a guard that fires on "Henüz seviye yok" is a guard nobody keeps.
 */
const NOT_FORMAL = new Set(['henüz', 'yalnız', 'yalnızca', 'deniz', 'gündüz', 'boynuz', 'domuz']);

/** 2. The formal pronoun itself, in every case the copy could reach for. */
const FORMAL_PRONOUN = /\b(?:siz|sizi|size|sizin|sizden|sizce|sizler)\b/g;

/**
 * 3. The formal imperative, `verb + -(y)in/-(y)ın/-(y)un/-(y)ün`, which is where shape
 *    alone runs out: that ending is identical to the 2nd-person-SINGULAR possessive on a
 *    noun. "Rezervasyon erişimin" (your access — informal, correct) and "tekrar deneyin"
 *    (try again — formal, wrong) differ only in word class, and a blanket regex flags
 *    `Yerin`, `Kulüplerin`, `kartın`, `rezervasyonun` and `gün` — the informal copy this
 *    rule is FOR.
 *
 *    So it is caught two ways instead. First, generally: an imperative in this catalog is
 *    almost always the polite request, and `Lütfen` can only be followed by a verb — so any
 *    `-in` word in a sentence opening with "Lütfen" is one, no list required. That is the
 *    exact shape of the defect this file was written for ("Lütfen tekrar deneyin").
 */
const POLITE_REQUEST = /lütfen\b[^.!?]*?\b(\w{3,}(?:y[ıiuü]n|[ıiuü]n))\b/g;

/**
 *    Second, by name, for the imperatives that appear without it. This list is the price
 *    of not false-positiving on every 2sg possessive in the catalog, and it is the one
 *    thing here that does not generalise: a formal imperative built from a verb NOT named
 *    below, and not preceded by "Lütfen", passes this file. Seeded from the two that were
 *    actually found in member copy (`ayırtın`, `doğrulayın`) plus every formal imperative
 *    the owner-facing namespaces use today, since those are the words a copywriter moving
 *    between the two halves of the product would carry across.
 */
const FORMAL_IMPERATIVES = [
  'deneyin', 'deneyiniz', 'ayırtın', 'doğrulayın', 'girin', 'seçin', 'ekleyin', 'bekleyin',
  'edin', 'tıklayın', 'yazın', 'kullanın', 'bakın', 'kapatın', 'açın', 'bırakın',
  'paylaşın', 'inceleyin', 'tamamlayın', 'tanımlayın', 'ayarlayın', 'yönetin', 'kaydedin',
  'silin', 'güncelleyin', 'yenileyin', 'belirleyin', 'kontrol edin',
] as const;

/** Every formal marker in one string, as the words themselves — so a failure names them. */
function formalMarkers(value: string): string[] {
  const lower = value.toLocaleLowerCase('tr');
  const found = new Set<string>();
  for (const m of lower.matchAll(FORMAL_SUFFIX)) {
    if (m[1] && !NOT_FORMAL.has(m[1])) found.add(m[0]);
  }
  for (const m of lower.matchAll(FORMAL_PRONOUN)) found.add(m[0]);
  for (const m of lower.matchAll(POLITE_REQUEST)) found.add(m[1]);
  for (const word of FORMAL_IMPERATIVES) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) found.add(word);
  }
  return [...found].sort();
}

const tr = load();

describe('formalMarkers, the detector this file rests on', () => {
  /**
   * Asserted before the sweep, and at this length, because the sweep's whole result is
   * `expect([]).toEqual([])` — a detector that silently stopped matching would leave every
   * assertion below passing while checking nothing. That is the failure mode this repo's
   * copy guards keep hitting, and it is cheaper to pin here than to discover later.
   */
  it.each([
    ['2pl possessive after a consonant', 'Bu saatte zaten bir rezervasyonunuz var.'],
    ['2pl possessive after a vowel', 'MultiSport kartınız o gün kullanılmış.'],
    ['2pl possessive under a case ending', 'Rezervasyonunuzu iptal edemedik.'],
    ['2pl possessive under a genitive', 'Kulübünüzün kurulumu.'],
    ['2pl verb ending', 'Bu seansı ayırtamazsınız.'],
    ['2pl past', 'Çok fazla deneme yaptınız.'],
    ['the pronoun', 'Size yeni bir bağlantı gönderdik.'],
    ['the polite request that started this', 'İptal edilemedi. Lütfen tekrar deneyin.'],
    ['a named imperative with no "lütfen"', 'Önce e-posta adresinizi doğrulayın.'],
    ['a bare named imperative', 'Önümüzdeki 7 gün için yer ayırtın.'],
  ])('sees %s', (_what, sentence) => {
    expect(formalMarkers(sentence)).not.toEqual([]);
  });

  /**
   * And the other half, which matters more: the informal 2nd-person-SINGULAR forms this
   * catalog is full of end in the same letters as the formal imperative. A detector that
   * flags `Yerin` or `erişimin` fires on the copy it is defending and gets deleted, taking
   * the guard with it. Every string here is real, in-catalog, and correct.
   */
  it.each([
    ['the seat the confirm dialog is about', 'Yerin bekleme listesindeki ilk kişiye geçer.'],
    ['the member’s own access', 'Rezervasyon erişimin kulüp tarafından kapatıldı.'],
    ['a plural noun with a 2sg possessive', 'Kulüplerin'],
    ['the informal rewrite of the toast', 'İptal edilemedi. Lütfen tekrar dene.'],
    ['the informal card', 'MultiSport kartın o gün başka bir seans için kullanılmış.'],
    ['the informal booking', 'Bu saatte zaten bir rezervasyonun var.'],
    ['an ordinary word that ends in -nüz', 'Henüz bir kulübe üye değilsin'],
    ['another one', 'Yalnızca ilk 50 üye listeleniyor.'],
    ['and one under a case ending, which the widened suffix must still exempt', 'Henüze kadar yok.'],
    ['the informal 2sg under a case ending', 'Rezervasyonunu iptal edemedik.'],
    ['a day, which is not a verb', 'Bu gün seans yok'],
  ])('stays quiet on %s', (_what, sentence) => {
    expect(formalMarkers(sentence)).toEqual([]);
  });
});

describe('the register a member is addressed in', () => {
  it('still has every namespace this file names', () => {
    // First and separately: a namespace that has been RENAMED would leave the sweep below
    // iterating an empty list and passing without asserting anything.
    const missing = [...MEMBER_NAMESPACES, ...OWNER_NAMESPACES]
      .filter((ns) => leaves(tr[ns] ?? '', ns).length === 0);
    expect(missing).toEqual([]);
  });

  it.each(MEMBER_NAMESPACES)('addresses the member informally throughout %s.*', (ns) => {
    const offenders = leaves(tr[ns], ns)
      .map(([path, value]) => [path, formalMarkers(value)] as const)
      .filter(([, markers]) => markers.length > 0)
      .map(([path, markers]) => `${path}: ${markers.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  /**
   * The scope line, asserted from the other side.
   *
   * Without this, `MEMBER_NAMESPACES` reads like a list somebody forgot to finish, and the
   * obvious "improvement" is to add `manage` and `admin` to it — which would fail on
   * dozens of strings that are formal BECAUSE THEY ARE CORRECT, and the repair anybody
   * reaches for at that point is to delete the file. Stating it as a positive claim means
   * the person who widens the sweep finds out here, with a reason.
   */
  it('leaves the owner speaking formally, which is the same rule', () => {
    const formalOwnerStrings = OWNER_NAMESPACES.flatMap((ns) =>
      leaves(tr[ns], ns).filter(([, value]) => formalMarkers(value).length > 0),
    );
    expect(formalOwnerStrings.length).toBeGreaterThan(10);
  });

  /**
   * The dialog that made the case, pinned as itself. A member decides here whether to give
   * up a seat, and the two sentences either side of that decision have to come from the
   * same voice — the general sweep above would still pass if a future rewrite made BOTH of
   * them formal, which is precisely the "consistent, and consistently wrong" outcome.
   */
  it('keeps the cancel confirm and its own failure toast in one voice', () => {
    const booking = tr.booking as Record<string, Node>;
    const cancelErrors = booking.cancelErrors as Record<string, string>;
    expect(formalMarkers(booking.confirmCancelTitle as string)).toEqual([]);
    expect(formalMarkers(cancelErrors.generic as string)).toEqual([]);
    expect(booking.confirmCancelTitle).toMatch(/musun/i);
    expect(cancelErrors.generic).toMatch(/dene\./i);
  });
});
