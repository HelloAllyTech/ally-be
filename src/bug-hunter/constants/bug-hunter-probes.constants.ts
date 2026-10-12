/**
 * Read-only production probes a Verifier or a study may call.
 *
 * A fix session sees one repo's source and no running system. For a bug
 * whose cause is data — a translation row that was never created, a tooltip
 * with no Marathi text — every local test passes and the symptom stays.
 * These probes are the running system: public GET endpoints that return what
 * a user's browser receives, so a claim about data carries what production
 * answered rather than what the code suggests it would.
 *
 * All of them are unauthenticated GETs against the public API. Nothing here
 * writes, and nothing here needs a key. Add a probe when a class of bug
 * needs one; keep each entry to what it answers and how to call it.
 */
export interface ProductionProbe {
  name: string;
  /** What question it answers. */
  answers: string;
  /** The exact call, with placeholders in angle brackets. */
  how: string;
}

export const productionProbes = (apiBaseUrl: string): ProductionProbe[] => {
  const api = apiBaseUrl.replace(/\/$/, '');
  return [
    {
      name: 'translations the apps load',
      answers:
        'whether a label has a value in a language in the PUBLISHED translation bundles (the helpline reads these at runtime, not the repo locale files)',
      how: `curl -sS "${api}/i18n/manifest.json" for currentVersion and namespaces, then curl -sS "${api}/i18n/<currentVersion>/<lang>/<namespace>.json" and look for the key; a missing key or an empty string here is the fault, whatever the repo file says`,
    },
    {
      name: 'simulations in a language',
      answers:
        'whether a simulation has a title and description translated for a language, as the helpline list shows it',
      how: `curl -sS "${api}/api/v1/learn/scenarios/public?languageCode=<lang>" and compare titles with languageCode=en; identical English text for mr/hi/kn/ta means the scenario has no translation row for that language in the database`,
    },
    {
      name: 'tooltips in a language',
      answers:
        'what the CMS tooltip text is for a language (Manage Tooltips in the admin, served translated)',
      how: `curl -sS "${api}/api/v1/tooltips/active?languageCode=<lang>" and compare tipText with languageCode=en`,
    },
    {
      name: 'a public endpoint the reporter named',
      answers:
        'what production returns for the request behind the screen in the report, when that request needs no login',
      how: `curl -sS -i "${api}/api/v1/<path the client calls>?<the parameters the client sends>" — find the call in the app code first (the api/ folder), then run it against production with the same parameters`,
    },
  ];
};

export const renderProductionProbes = (apiBaseUrl: string): string[] =>
  productionProbes(apiBaseUrl).map(
    (p) => `  - ${p.name} — answers ${p.answers}. How: ${p.how}`,
  );
