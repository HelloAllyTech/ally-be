import { readFileSync } from 'fs';
import { join } from 'path';

const SCRIPTS = join(__dirname, '..', '..', '..', '..', 'scripts', 'builder');

const runEngine = (): string =>
  readFileSync(join(SCRIPTS, 'run-engine.sh'), 'utf8');

const installEngine = (): string =>
  readFileSync(join(SCRIPTS, 'install-engine.sh'), 'utf8');

/**
 * The `run_agent` function body — the one place a phase becomes an
 * `opencode run`.
 */
const opencodeCase = (): string => {
  const source = runEngine();
  const start = source.indexOf('\nrun_agent() {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('opencode engine invocation', () => {
  /**
   * Each call site names the opencode agent it runs as: `builder` for the
   * phases that write, `reviewer` for the read-only ones, whose denied tools
   * are never offered at all. Anything else is refused rather than run with
   * the defaults.
   */
  it('runs as the agent the call site names, and only a known one', () => {
    const body = opencodeCase();

    expect(body).toMatch(/agent="\$4"/);
    expect(body).toMatch(/builder \| reviewer\) ;;/);
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
