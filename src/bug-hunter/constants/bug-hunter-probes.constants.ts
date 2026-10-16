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
        'whether a simulation has a title and description STORED for a language — the same stored translations the logged-in Simulations tab reads (GET /api/v2/learn/scenarios?languageCode=<lang>, which needs a login)',
      how: `curl -sS "${api}/api/v1/learn/scenarios/public" for ids, then curl -sS "${api}/api/v1/learn/scenarios/<id>/public?languageCode=<lang>" and compare title and description with languageCode=en. Identical English text for hi/mr/ta/kn (every simulation is translated into the app-picker languages), or for another language the scenario has a voice for (metadata.languageVoices in ally-be), means scenarios.translations has no entry for that language. Only ally-be writes that entry (persistTranslationsForScenarios in src/learn/service/scenario.service.ts), so the fault is usually that generation never ran for the language — ally-be code plus a backfill — never the frontend. Do NOT judge from the public LIST: /api/v1/learn/scenarios/public ignores languageCode and always answers in English`,
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

/**
 * Probes that need ally-be itself: fixed, named, read-only questions about
 * live data and logs, answered by BugHunterProbeService over the pipeline's
 * API key (GET pipeline/probes/:name).
 *
 * The public probes above see what an anonymous browser sees. These see what
 * a public endpoint cannot: which configured languages have no stored
 * translation, which roles hold a permission, what an org has switched on,
 * what the backend logged. On 2026-10-12 the fault behind a "Marathi titles
 * show English" report was missing translation entries for all 188
 * scenarios; a person found it by hand because no run could ask the data.
 *
 * Rules every probe keeps: a fixed query (never SQL from the caller), a
 * read-only transaction with a short statement timeout, answers as ids,
 * counts and authored text (titles, locations, permission names) — never a
 * learner's data — and every call recorded against the run.
 */
export interface PipelineProbe {
  name: string;
  answers: string;
  /** Query parameters, with their defaults. */
  params: string;
}

export const PIPELINE_PROBES: PipelineProbe[] = [
  {
    name: 'scenario-translations',
    answers:
      'for one language: how many ACTIVE simulations should have a title in it (all of them for the app-picker languages hi/mr/ta/kn, otherwise those with a voice in metadata.languageVoices), how many have a stored title translation (scenarios.translations[code] and scenario_translations rows), the ids missing one, and the title a learner is served',
    params:
      'languageCode (required, e.g. mr), tenant (default ally), scenarioId (optional, one simulation), limit (default 25)',
  },
  {
    name: 'tooltip-translations',
    answers:
      'for one language: active Manage Tooltips entries with and without a translation, and the locations missing one',
    params: 'languageCode (required), limit (default 25)',
  },
  {
    name: 'role-permissions',
    answers:
      'which permissions a role (group) holds, or which roles hold one permission — the check for "works for one role, 403 for another"',
    params: 'role (group name, partial match) OR permission (exact name)',
  },
  {
    name: 'org-preferences',
    answers:
      "an organisation's switched-on preferences and feature toggles, by name",
    params: 'tenant (default ally)',
  },
  {
    name: 'languages',
    answers:
      'the languages table: id, value, translationCode, active — the codes clients send and the ids languageVoices uses',
    params: 'none',
  },
  {
    name: 'recent-errors',
    answers:
      "a backend service's logged errors in a window, filtered by a phrase — the first look for a 500 or a DATABASE_ERROR",
    params:
      'service (ally-be | ally-ai | ally-ai-learn), minutes (default 60, max 1440), search (optional phrase), limit (default 30)',
  },
];

export const PIPELINE_PROBE_NAMES = PIPELINE_PROBES.map((p) => p.name);

export const renderPipelineProbes = (
  apiBaseUrl: string,
  runId: string,
  authHeader: string,
): string[] => {
  const base = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/bug-hunter/pipeline/probes`;
  return [
    `  Call: curl -sS "${base}/<name>?<params>&runId=${runId}" ${authHeader} — JSON back. The catalogue: curl -sS "${base}" ${authHeader}.`,
    ...PIPELINE_PROBES.map(
      (p) => `  - ${p.name} — answers ${p.answers}. Params: ${p.params}.`,
    ),
  ];
};
