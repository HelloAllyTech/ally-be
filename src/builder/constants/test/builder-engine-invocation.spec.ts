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
   * The point of the list, and the reason it survives having one entry.
   *
   * A session carries its creation engine forever, so hours after every phase
   * had been moved off Claude Code a review still dispatched `claude-code`
   * with `claude-opus-4-7` and reviewed a pull request on another vendor's
   * credits. A stale engine and an admin typing one cost the same money. Now
   * that opencode runs every vendor's models itself, nothing else needs to be
   * permitted — but the list is what turns a stale value into an overrule
   * rather than a bill.
   */
  it('permits opencode alone', () => {
    delete process.env.BUILDER_ENGINE_ALLOWED;

    expect(builderAllowedEngines()).toEqual(['opencode']);
    expect(builderAllowedEngines()).not.toContain('claude-code');
    expect(builderAllowedEngines()).not.toContain('gemini');
    expect(BUILDER_ENGINE_ALLOWED_DEFAULT).toEqual(['opencode']);
  });

  /**
   * One env var, because the friction should match the decision: putting
   * another vendor back on the list is a choice about someone else's bill.
   */
  it('is changed without a deploy, and an empty value lifts it entirely', () => {
    process.env.BUILDER_ENGINE_ALLOWED = 'opencode';
    expect(builderAllowedEngines()).toEqual(['opencode']);

    process.env.BUILDER_ENGINE_ALLOWED = ' opencode , gemini ';
    expect(builderAllowedEngines()).toEqual(['opencode', 'gemini']);

    // Empty means unrestricted rather than "nothing allowed", which would
    // brick every build on a typo.
    process.env.BUILDER_ENGINE_ALLOWED = '';
    expect(builderAllowedEngines()).toEqual([]);
  });

  /**
   * The first entry is where anything unpermitted lands, so it has to be an
   * engine that can actually run the compiled model defaults. opencode can run
   * any of them, which is the whole reason the other engines could go.
   */
  it('falls back to the engine that can run the model defaults', () => {
    delete process.env.BUILDER_ENGINE_ALLOWED;

    expect(builderAllowedEngines()[0]).toBe('opencode');
    for (const [tier, model] of Object.entries(BUILDER_MODEL_DEFAULTS)) {
      expect(`${tier}=${model}`).toMatch(/=[a-z0-9.-]+$/);
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
   * way its vendor does — `gemini-2.5-pro`, `claude-opus-4-7`.
   *
   * The provider is derived from the id, not assumed. This line used to prefix
   * EVERYTHING with `google/`, which was harmless while Gemini was the only
   * thing anyone set and wrong the moment it was not: prod held
   * `claude-opus-4-7` in its settings for a day, which became
   * `google/claude-opus-4-7`, a model no provider has, and every phase died on
   * it. Now that opencode is the only engine, naming a model IS how a vendor
   * is chosen, so this mapping is the whole multi-vendor story.
   */
  it('derives the provider from the model id', () => {
    const body = opencodeCase();

    expect(body).toMatch(/claude-\*\) oc_model="anthropic\/\$\{oc_model\}"/);
    expect(body).toMatch(/gemini-\*\) oc_model="google\/\$\{oc_model\}"/);
    expect(body).toMatch(/oc_model="openai\/\$\{oc_model\}"/);
  });

  /**
   * An id that already names its provider passes through untouched, so an
   * explicit `anthropic/…` in a settings row still wins — and an unrecognised
   * shape passes too, because opencode's own error names the provider it could
   * not find, which beats this case inventing one.
   */
  it('leaves a qualified id alone', () => {
    expect(opencodeCase()).toMatch(/\*\/\*\) ;;/);
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
