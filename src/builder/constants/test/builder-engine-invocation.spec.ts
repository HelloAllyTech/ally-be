import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BUILDER_ENGINE_PIN_DEFAULT,
  BUILDER_MODEL_DEFAULTS,
  builderEnginePin,
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
describe('the engine pin', () => {
  const before = process.env.BUILDER_ENGINE_PIN;
  afterEach(() => {
    if (before === undefined) delete process.env.BUILDER_ENGINE_PIN;
    else process.env.BUILDER_ENGINE_PIN = before;
  });

  /**
   * The whole point. Builder was verified end to end as Gemini on 2026-09-23 —
   * interview, build dispatch, in-process phases — and hours later dispatched
   * a REVIEW run on `claude-code` with `claude-opus-4-7`, a model id that
   * exists nowhere in this codebase, because a session created before the
   * migration carries its original engine forever and the review path reads
   * it. Unset means pinned: no environment change is needed for this to hold.
   */
  it('pins to gemini when nothing says otherwise', () => {
    delete process.env.BUILDER_ENGINE_PIN;

    expect(builderEnginePin()).toBe('gemini');
    expect(BUILDER_ENGINE_PIN_DEFAULT).toBe('gemini');
  });

  /**
   * One env var to clear rather than a deploy — and the empty string means
   * unpinned rather than pinned to nothing, which is the reading a
   * `?? DEFAULT` would have got wrong.
   */
  it('can be lifted, or moved, without a deploy', () => {
    process.env.BUILDER_ENGINE_PIN = '';
    expect(builderEnginePin()).toBeNull();

    process.env.BUILDER_ENGINE_PIN = 'claude-code';
    expect(builderEnginePin()).toBe('claude-code');

    process.env.BUILDER_ENGINE_PIN = '  gemini  ';
    expect(builderEnginePin()).toBe('gemini');
  });

  /**
   * A pin that named an engine the model defaults do not belong to would move
   * the mismatch one layer down rather than close it: `gemini --model
   * claude-opus-4-7` exits on its first phase having written nothing.
   */
  it('names an engine every model default belongs to', () => {
    delete process.env.BUILDER_ENGINE_PIN;

    expect(builderEnginePin()).toBe('gemini');
    for (const [tier, model] of Object.entries(BUILDER_MODEL_DEFAULTS)) {
      expect(`${tier}=${model}`).toMatch(/=gemini-/);
    }
  });
});
