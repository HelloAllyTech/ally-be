import { LoggerService } from 'src/logger/logger.service';
import { BUILDER_PROMPTS } from './builder.constants';

/**
 * The platform rules: what holds for every change on Ally, given to every
 * Builder agent — the interviewer, the technical designer and its critic, the
 * planner, coder, verifier, remediator, finaliser, fixer and reviewer.
 *
 * Hand-written and authoritative, which is what separates them from lessons:
 * a lesson is learned from one run and advisory, a rule is a constraint the
 * platform cannot ship without. The one that made them necessary is the first
 * — session 880e73e6 (2026-10-12) shipped a plan that renamed a persisted JSON
 * key, and every released mobile build reading the old key broke. Nothing any
 * agent was told said released clients lag the backend.
 *
 * `builder_platform_rules` is the source of truth and ships as
 * src/prompts/builder/platform_rules.txt carrying this same text. This copy is
 * the fallback for a missing row or an unreachable database, so the rules
 * degrade to what shipped rather than to nothing — an agent that has quietly
 * lost "never rename a persisted key" still runs, and is simply dangerous.
 */
export const DEFAULT_PLATFORM_RULES = `## Platform rules

These hold for every change on the Ally platform. They are not advice: a plan,
design or change that breaks one is wrong, however well it is built.

- **Released clients lag the backend by weeks.** ally-mobile ships through the
  app stores and people do not update; the backend deploys first. So a change
  to anything a client reads — an API field, an enum value, a stored JSON key a
  response passes through — is **additive**: add the new field next to the old
  one and keep the old one meaning what it meant. Never rename, remove or
  change the type of something a released client reads.
- **Never rename or restructure a persisted JSON key** to suit new code. Add a
  new optional key and derive the old one from it, so old readers keep working.
  A migration that rewrites existing rows needs a reason the PRD states, and a
  rollback.
- **Find every reader before changing a field.** grep every repo for it —
  ally-be services, validators, translation, LLM prompts and graders; ally-web
  admin and learner apps; ally-mobile screens and tests. A field has more
  readers than the file that declares it.
- **Reuse what exists.** Sanitizers, renderers, editors and components already
  exist for most needs (e.g. \`sanitizeDescriptionHtml\` and \`htmlToPlainText\` in
  ally-be, \`RichTextEditor\`/\`RichTextRenderer\` in ally-web, \`RichText\` in
  ally-mobile). Building a second one is a defect.
- **Stay in scope.** Do not edit code, tests or snapshots the change does not
  need. A test that fails for a reason the change did not cause is reported,
  not "fixed".
- **Tests come with the change.** Every requirement gets a test that fails
  without it. Editing existing assertions to match new behaviour is not a test
  of the new behaviour.
- **Resolve ambiguity the way a careful engineer would.** The requirements
  and their acceptance criteria define the scope. When the code shows more than
  the task says — a shared type with uses the task never mentions, a choice the
  task left open — take the narrowest reading that satisfies the requirements
  and leaves the system consistent, and **write the assumption down where a
  reviewer will see it**: what you left out, and why nothing breaks. Ask only
  when the choice is costly or hard to reverse, or when the narrow reading
  leaves something broken. Never build half of something whose other half is
  out of scope.
- **Multi-tenant.** Nearly every ally-be entity carries \`tenantId\`; a query
  without tenant isolation is a data leak.
- **Docs move with code.** Touching an entity means updating \`DATA_SCHEMA.md\`;
  \`.docs-map.yml\` says which docs cover which code.`;

/** Anything that can look a prompt up by code. */
interface PromptLookup {
  getPromptByCode(promptCode: string): Promise<string | null>;
}

/**
 * The rules as prompt management has them, or the compiled default.
 *
 * Never an empty string, and never throws: an outage in prompt management
 * must not fail a build already an hour in, and a blank rules block is the
 * failure nobody notices.
 */
export async function loadPlatformRules(
  prompts: PromptLookup | null | undefined,
): Promise<string> {
  if (!prompts) return DEFAULT_PLATFORM_RULES;
  try {
    const text = await prompts.getPromptByCode(BUILDER_PROMPTS.PLATFORM_RULES);
    if (text?.trim()) return text.trim();
  } catch (error) {
    // Resolved here rather than at module load: this file is imported by
    // every phase prompt, and load-time work in a shared module is what
    // breaks unrelated suites.
    LoggerService.getInstance('BuilderPlatformRules').warn(
      `Could not load "${BUILDER_PROMPTS.PLATFORM_RULES}", using the compiled default: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return DEFAULT_PLATFORM_RULES;
}

/**
 * The rules as a prompt section, for every phase prompt's top.
 *
 * One renderer so the block reads identically in every phase and stays in the
 * cacheable prefix. An absent value falls back to the default rather than to
 * nothing, for the same reason the loader never returns empty.
 */
export function renderPlatformRules(rules?: string | null): string {
  return (rules?.trim() || DEFAULT_PLATFORM_RULES).trim();
}
