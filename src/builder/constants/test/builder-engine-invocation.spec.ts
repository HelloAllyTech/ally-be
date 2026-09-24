import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BUILDER_ENGINE_ALLOWED_DEFAULT,
  BUILDER_MODEL_DEFAULTS,
  builderAllowedEngines,
} from '../builder.constants';

const SCRIPTS = join(__dirname, '..', '..', '..', '..', 'scripts', 'builder');

const runEngine = (): string =>
  readFileSync(join(SCRIPTS, 'run-engine.sh'), 'utf8');

const installEngine = (): string =>
  readFileSync(join(SCRIPTS, 'install-engine.sh'), 'utf8');

/**
 * The `case "$ENGINE" in gemini)` body, from the label to the `;;` that ends
 * it. Read from the source rather than exercised, because run-engine.sh is a
 * script with side effects from its first line and cannot be sourced to get at
 * one branch of it.
 */
const geminiCase = (): string => {
  const source = runEngine();
  const start = source.indexOf('\n    gemini)');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n      ;;', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

/**
 * The `case "$ENGINE" in opencode)` body.
 */
const opencodeCase = (): string => {
  const source = runEngine();
  const start = source.indexOf('\n    opencode)');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n      ;;', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

/**
 * Two invariants of the Gemini invocation, both of which fail SILENTLY when
 * they are wrong — which is the only reason they are worth a test. Neither
 * produces an error the runner can see: one hangs until the phase wall clock
 * kills it, the other downgrades the approval mode and waits for a person who
 * is not there. A silent stall looks exactly like a slow model.
 *
 * Both held on @google/gemini-cli 0.22.5 and stopped holding on 0.60.0, so the
 * failure mode this guards is specifically "the old invocation was carried
 * forward across a version bump".
 */
describe('gemini engine invocation', () => {
  /**
   * On 0.22.5 a positional argument meant non-interactive. On 0.60.0 `--help`
   * reads: "Initial prompt. Runs in interactive mode by default; use -p/
   * --prompt for non-interactive." The positional form does not error on a
   * runner with no TTY — it opens the interactive CLI and sits there.
   */
  it('passes the prompt with -p, never as a positional argument', () => {
    const body = geminiCase();

    expect(body).toMatch(/gemini -p "\$\(cat "\$prompt_file"\)"/);
    expect(body).not.toMatch(/gemini "\$\(cat "\$prompt_file"\)"/);
  });

  /**
   * 0.60.0 refuses to run in a directory it has not been told to trust, and —
   * worse than refusing — when given `--yolo` in an untrusted directory it
   * prints "Approval mode overridden to 'default'" and continues, so every
   * tool call waits for an approval no one can give. A repo cloned onto a
   * fresh runner is never trusted.
   */
  it('declares the workspace trusted, so --yolo is not silently downgraded', () => {
    const body = geminiCase();

    // Both channels, because the redundancy costs nothing and the failure is
    // silent: the environment variable and the flag say the same thing.
    expect(body).toMatch(/GEMINI_CLI_TRUST_WORKSPACE=true/);
    expect(body).toMatch(/--skip-trust/);
  });

  /**
   * The live feed, the cost step and every phase budget read the normalised
   * stream. Without this flag the run still works and reports nothing.
   */
  it('asks for the stream the forwarder knows how to read', () => {
    expect(geminiCase()).toMatch(/--output-format stream-json/);
  });

  /**
   * The pin is the contract the two tests above are written against. If it
   * moves, they have to be re-verified against the new binary rather than
   * assumed — that is the whole lesson of this file.
   */
  it('is written against the pinned engine version', () => {
    expect(installEngine()).toMatch(/GEMINI_CLI_VERSION="0\.60\.0"/);
  });
});

/**
 * Everything runs on one engine, and the pin is what makes that true rather
 * than merely configured.
 */
describe('the engine allowlist', () => {
  const before = process.env.BUILDER_ENGINE_ALLOWED;
  afterEach(() => {
    if (before === undefined) delete process.env.BUILDER_ENGINE_ALLOWED;
    else process.env.BUILDER_ENGINE_ALLOWED = before;
  });

  /**
   * The point of the list, and the reason it is a list rather than a pin.
   *
   * A session carries its creation engine forever, so hours after every phase
   * had been moved to Gemini a review dispatched `claude-code` with
   * `claude-opus-4-7` and reviewed a pull request on another vendor's credits.
   * A stale `claude-code` and an admin typing `claude-code` cost the same
   * money, so neither is permitted — while `opencode` is, which is what makes
   * a comparison run possible without editing a production environment.
   */
  it('permits gemini and opencode, and not claude-code', () => {
    delete process.env.BUILDER_ENGINE_ALLOWED;

    expect(builderAllowedEngines()).toEqual(['gemini', 'opencode']);
    expect(builderAllowedEngines()).not.toContain('claude-code');
    expect(BUILDER_ENGINE_ALLOWED_DEFAULT).toEqual(['gemini', 'opencode']);
  });

  /**
   * One env var, because the friction should match the decision: putting
   * another vendor back on the list is a choice about someone else's bill.
   */
  it('is changed without a deploy, and an empty value lifts it entirely', () => {
    process.env.BUILDER_ENGINE_ALLOWED = 'gemini';
    expect(builderAllowedEngines()).toEqual(['gemini']);

    process.env.BUILDER_ENGINE_ALLOWED = ' gemini , opencode ';
    expect(builderAllowedEngines()).toEqual(['gemini', 'opencode']);

    // Empty means unrestricted rather than "nothing allowed", which would
    // brick every build on a typo.
    process.env.BUILDER_ENGINE_ALLOWED = '';
    expect(builderAllowedEngines()).toEqual([]);
  });

  /**
   * The first entry is where anything unpermitted lands, so it has to be an
   * engine whose model defaults actually belong to it.
   */
  it('falls back to an engine its model defaults belong to', () => {
    delete process.env.BUILDER_ENGINE_ALLOWED;

    expect(builderAllowedEngines()[0]).toBe('gemini');
    for (const [tier, model] of Object.entries(BUILDER_MODEL_DEFAULTS)) {
      expect(`${tier}=${model}`).toMatch(/=gemini-/);
    }
  });
});

describe('opencode engine invocation', () => {
  /**
   * Read-only is one decision across three engines.
   *
   * Claude Code takes a tool allowlist, Gemini takes nothing and is undone
   * afterwards by revert_stray_writes, and opencode takes an AGENT whose
   * denied tools are never offered at all. What decides which is the same
   * allowlist string in every case — anything permitted to Write is the
   * builder, everything else reviews — so a phase cannot be read-only on one
   * engine and not another.
   */
  it('picks its agent from the same allowlist the other engines use', () => {
    const body = opencodeCase();

    expect(body).toMatch(/case "\$tools" in \*Write\*\) agent="builder"/);
    expect(body).toMatch(/--agent "\$agent"/);
  });

  /** The stream the forwarder knows how to read. */
  it('asks for the JSON stream and a model per invocation', () => {
    const body = opencodeCase();

    expect(body).toMatch(/--format json/);
    expect(body).toMatch(/--model "\$oc_model"/);
  });

  /**
   * opencode names a model `provider/model`; everything upstream names one the
   * way its vendor does, because those same values must satisfy the gemini
   * engine, which rejects a prefixed id.
   *
   * Found the hard way: the first opencode dispatch handed it a bare
   * `gemini-2.5-pro`, straight from the settings row that the admin picker and
   * BUILDER_MODEL_DEFAULTS also feed. The translation belongs at this boundary,
   * which is the only place that knows both conventions.
   */
  it('gives a bare model id a provider, and leaves a qualified one alone', () => {
    const body = opencodeCase();

    expect(body).toMatch(/oc_model="google\/\$\{oc_model\}"/);
    // An id that already names its provider passes through untouched, so a
    // settings row saying `anthropic/…` keeps working without this line
    // learning about it.
    expect(body).toMatch(/case "\$oc_model" in \*\/\*\)/);
  });

  /**
   * The runner is the isolation boundary, as it already is for --yolo and
   * acceptEdits. What makes that safe for a reviewer is the denial in
   * opencode.json, not this flag.
   */
  it('approves what is not denied, because nobody is there to ask', () => {
    expect(opencodeCase()).toMatch(/--auto/);
  });

  /**
   * The coding attempts share one conversation; the planner and reviewer do
   * not.
   *
   * Every `opencode run` is its own session, and one build made three — each
   * beginning with no memory of the last. The remediation prompt opens
   * "address the feedback from the previous attempt" to an agent that has
   * never seen the attempt, so it re-reads the repository to rediscover what
   * it wrote minutes earlier.
   *
   * The reviewer stays cold deliberately: one that remembers writing the diff
   * is not an independent reviewer, which is the only reason that phase
   * exists.
   */
  it('continues the coding session, and only the coding session', () => {
    const body = opencodeCase();

    expect(body).toMatch(/\$AGENT_PHASE" = code/);
    expect(body).toMatch(/--session/);
    // Guarded, so an engine that reports no session leaves every attempt cold
    // exactly as before rather than passing an empty flag.
    expect(body).toMatch(/-n "\$\{OPENCODE_CODER_SESSION:-\}"/);
  });

  /**
   * The spike's one trap: the `google` provider reads
   * GOOGLE_GENERATIVE_AI_API_KEY and NOT GEMINI_API_KEY, though the binary
   * contains all three names. A run without it dies on ProviderAuthError
   * having done nothing — and, as the spike's own first run showed, a pipeline
   * downstream of that reads the silence as a pass.
   */
  it('is installed at the version the spike verified', () => {
    expect(installEngine()).toMatch(/OPENCODE_VERSION="1\.18\.32"/);
  });
});
