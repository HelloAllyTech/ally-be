/**
 * Playbooks: how to locate a class of bug, written from cases Bug Hunter got
 * wrong or a person had to finish.
 *
 * A study starts cold: one repo, the reporter's words, no idea which layer
 * usually breaks for a bug that reads like this. A playbook is the first
 * five minutes an engineer who has seen the class before would spend: the
 * check that settles it, the evidence that counts, where the fix usually
 * is, and the tempting fix that is wrong.
 *
 * They are code, not notebook rows, on purpose: few, reviewed, and tested.
 * The notebook keeps the long tail of lessons a run writes for itself; a
 * lesson that keeps coming back belongs here. `when` is matched against the
 * bug's title and description; the two best matches are served.
 */
export interface BugHunterPlaybook {
  id: string;
  title: string;
  /** Phrases that mark a bug as this class; each match scores one. */
  when: RegExp[];
  /** The first thing to check, before reading any code. */
  firstCheck: string;
  /** What counts as evidence for each layer. */
  evidence: string;
  /** Where the fix usually lives. */
  usualFix: string;
  /** The tempting fix that is wrong. */
  notThis: string;
  /** The case the playbook was written from. */
  learnedFrom: string;
}

export const BUG_HUNTER_PLAYBOOKS: BugHunterPlaybook[] = [
  {
    id: 'content-not-translated',
    title: 'Content stays in English after the user picks another language',
    when: [
      /\b(english|untranslated|not translated|translat\w*)\b/i,
      /\b(marathi|hindi|kannada|tamil|language|locale)\b/i,
      /\b(simulation|scenario|title|description|tooltip|course|track|prompt|template)s?\b/i,
    ],
    firstCheck:
      'Decide whether the text is CONTENT (a row an admin authors: simulation titles, tooltips, courses, templates) or a LABEL (text that only exists in code). For content, ask the data first: the scenario-translations or tooltip-translations probe for that language, or the public detail route with ?languageCode=. Compare with languageCode=en.',
    evidence:
      'Identical English from the API for a language the item is configured for means the stored translation is missing: a data fault whose cause is in the code that should have generated it. A translated API answer with English on screen means the client drops or never sends the language code.',
    usualFix:
      'In ally-be: the generation path (persistTranslationsForScenarios for simulations; the tooltip translation service for tooltips) skips the case, plus an idempotent backfill for rows that already exist. In the client only when the API already answers translated.',
    notThis:
      'Running content through i18n t() or copying it into a locale file. The API returns plain text, not keys, and content belongs in its table.',
    learnedFrom:
      'e7625fc8 (2026-10-12): ally-web PR #798 translated simulation titles in the card component; all 188 scenarios had no stored Marathi or Hindi entry.',
  },
  {
    id: 'label-not-translated',
    title: 'A button, heading or label stays in English',
    when: [
      /\b(button|label|heading|placeholder|tooltip|close|menu|tab)\b/i,
      /\b(english|untranslated|not translated|translat\w*)\b/i,
    ],
    firstCheck:
      'Find the key on screen in the PUBLISHED bundle the app loads (api.helloally.ai/i18n/<version>/<lang>/<namespace>.json, see the translations probe), not only in the repo locale file. Then check the component passes the key through t(), and whether a library default (a Carbon ComposedModal close label, say) renders text nobody passed.',
    evidence:
      'Key missing or blank in the published bundle: run the parity script and sync with a translate key. Key present but English on screen: the component hard-codes the string or uses a library default.',
    usualFix:
      'A locale key used through t() in the component, with real translations for every language; for a library default, pass the translated prop explicitly.',
    notThis:
      'Writing "" for missing keys (i18n:sync without its key blanks the screen) or pasting the English into other locale files.',
    learnedFrom:
      "34ffc8ff (2026-10-12): the Report-a-bug dialog's Close tooltip was Carbon's default label; 2026-10-01: a keyless sync blanked 385 strings per language.",
  },
  {
    id: 'permission-denied-for-a-role',
    title: 'Works for one role, 403 or a missing screen for another',
    when: [
      /\b(403|forbidden|permission|not allowed|access denied|missing (button|menu|tab))\b/i,
      /\b(role|admin|tenant admin|trainer|learner|super ?admin|multi-tenant)\b/i,
    ],
    firstCheck:
      'Ask the role-permissions probe which roles hold the permission the route needs (the @AuthPermissions decorator names it). Compare the failing role with the working one.',
    evidence:
      'The failing role lacks the grant: a missing group_permissions row, usually a cloned role that never got a grant later added to its source. The role holds it: the client gates on the single legacy role instead of the roles array, or a Redis permission cache is stale.',
    usualFix:
      'A migration granting the permission to every role that should have it, including cloned roles; or the client gate moved to the roles array.',
    notThis:
      'Widening the route, removing the permission check, or gating on the collapsed single role.',
    learnedFrom:
      '2026-07-24: multi-tenant admins lacked view:scenario-voices; four permission incidents are listed in the wiki gotchas.',
  },
  {
    id: 'blank-page-or-render-loop',
    title: 'Blank page, frozen screen, or a request fired in a loop',
    when: [
      /\b(blank|white screen|frozen|hangs?|infinite|loop|keeps (re)?loading|spinner forever)\b/i,
    ],
    firstCheck:
      "Read the effects on the route's first screen and their dependency arrays, especially anything changed recently by a lint autofix. Check web-logs for the page.",
    evidence:
      'An effect whose dependency is recreated every render (a function or object not memoised) and whose body sets state or fetches is the loop. A thrown render error shows in browser exceptions instead.',
    usualFix:
      'Memoise the dependency or drop it from the array with the reason in a comment; keep the effect running once.',
    notThis:
      'Adding the function to the dependency array because the exhaustive-deps rule asked, without memoising it.',
    learnedFrom:
      'PR #724 (2026-09): a [checkAuth] dependency made the web login page loop and go blank.',
  },
  {
    id: 'field-never-returned',
    title: 'A value is blank, zero or "undefined" on screen',
    when: [
      /\b(blank|empty|missing|undefined|null|shows 0|zero|not shown|not showing|wrong count)\b/i,
    ],
    firstCheck:
      'Call the endpoint the screen uses and look for the field in the response before reading the component. Then read the backend select or DTO.',
    evidence:
      'Field absent from the response: the backend never selects or returns it, and the client was written against a field that does not exist. Field present: the client reads the wrong key or the wrong shape.',
    usualFix:
      'Return the field from the backend (select, DTO, mapping) and render it; both repos when the client never read it either.',
    notThis:
      'A client-side fallback or computed guess that hides the missing field.',
    learnedFrom:
      'Simulation cards (2026-07-16): difficulty and duration were never returned by the backend; course simulation counts (2026-09-18) counted the wrong collection.',
  },
  {
    id: 'server-error',
    title: '"Something went wrong" or a 500',
    when: [
      /\b(500|something went wrong|server error|database_error|internal error|crash(es|ed)?)\b/i,
    ],
    firstCheck:
      'Ask the recent-errors probe for the service with the route or error code as the search phrase, in the minutes around the report.',
    evidence:
      'The logged stack names the line. DATABASE_ERROR is usually a constraint, a missing column after an undeployed migration, or a value too long for its column.',
    usualFix:
      'At the line the log names, with a test that sends the failing input; a migration if the schema is behind.',
    notThis: 'Catching the error and returning success, or retrying.',
    learnedFrom:
      '2026-10-13: POST /product-roadmap/bug-reports returned DATABASE_ERROR whenever the structured fields were sent.',
  },
];

const score = (p: BugHunterPlaybook, text: string): number =>
  p.when.filter((re) => re.test(text)).length;

/** Phrases a playbook needs to fit: all of them on a short list, all but one on a list of three or more. */
const needed = (p: BugHunterPlaybook): number =>
  p.when.length >= 3 ? p.when.length - 1 : p.when.length;

/** The playbooks that fit a bug, best first. */
export function playbooksFor(text: string, limit = 2): BugHunterPlaybook[] {
  return BUG_HUNTER_PLAYBOOKS.map((p) => ({ p, s: score(p, text) }))
    .filter(({ p, s }) => s >= needed(p))
    .sort((a, b) => b.s / b.p.when.length - a.s / a.p.when.length || b.s - a.s)
    .slice(0, limit)
    .map(({ p }) => p);
}

export const renderPlaybooks = (playbooks: BugHunterPlaybook[]): string[] =>
  playbooks.length
    ? [
        `## Playbooks for bugs like this one`,
        `How bugs of this class were located before. Advice from past cases, not orders: your probes and the code decide.`,
        ...playbooks.flatMap((p) => [
          `### ${p.title}`,
          `- First check: ${p.firstCheck}`,
          `- Evidence: ${p.evidence}`,
          `- Usual fix: ${p.usualFix}`,
          `- Not this: ${p.notThis}`,
          `- Learned from: ${p.learnedFrom}`,
        ]),
        ``,
      ]
    : [];
