import { BuilderMessage } from '../../entity/builder-message.entity';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { BuilderPrdReadiness } from '../../type/builder-prd.type';
import { BUILDER_EVIDENCE_TOOLS } from '../../service/builder-evidence-log.service';
import { BuilderEvalGates } from '../type/builder-eval.type';

/** Tools that end the visible turn: whatever else is in their batch, the reply is already decided. */
const TERMINAL_TOOLS = new Set(['ask_admin']);
const EDIT_TOOLS = new Set(['update_prd']);

/**
 * Prose that tells the admin the PRD moved. Deliberately narrow — "I'll
 * update" is a promise, not a claim, and is left alone; the failure being
 * counted is session 2bc3a5cf's "I've revised the PRD" over a failed edit.
 */
const CLAIMS_AN_EDIT =
  /\b(I'?ve|I have|I)\s+(just\s+)?(updated|revised|added|amended|rewritten|recorded|captured|incorporated|reflected|written)\b|\b(updated|revised)\s+the\s+PRD\b|\bPRD\s+(is|has been|now)\s+(updated|revised)\b/i;

/** One model pass: the content blocks it returned, in order. */
export interface ScoredPass {
  content: any[];
}

interface ToolOutcome {
  name: string;
  ok: boolean;
}

/** Tool results across the transcript, by the tool_use id they answer. */
function outcomesById(messages: BuilderMessage[]): Map<string, ToolOutcome> {
  const outcomes = new Map<string, ToolOutcome>();
  for (const message of messages) {
    for (const result of message.toolResults ?? []) {
      if (!result?.toolUseId) continue;
      outcomes.set(String(result.toolUseId), {
        name: String(result.name ?? ''),
        ok: result.result?.ok !== false,
      });
    }
  }
  return outcomes;
}

/**
 * The deterministic gates for one replay.
 *
 * Batch-level gates read the passes the sandbox captured — the only record of
 * which calls went out together, since the transcript stores a turn's calls
 * flat. Turn-level gates read the stored messages. Consistency and evidence
 * read the final readiness, which already computes both.
 */
export function computeEvalGates(
  passes: ScoredPass[],
  messages: BuilderMessage[],
  finalReadiness: BuilderPrdReadiness,
): BuilderEvalGates {
  const outcomes = outcomesById(messages);

  let unseenFailures = 0;
  let askedBeforeReading = 0;
  for (const pass of passes) {
    const uses = (pass.content ?? []).filter(
      (block: any) => block?.type === 'tool_use',
    );
    if (!uses.some((block: any) => TERMINAL_TOOLS.has(String(block.name)))) {
      continue;
    }
    const others = uses.filter(
      (block: any) => !TERMINAL_TOOLS.has(String(block.name)),
    );
    unseenFailures += others.filter(
      (block: any) => outcomes.get(String(block.id))?.ok === false,
    ).length;
    if (
      others.some((block: any) =>
        BUILDER_EVIDENCE_TOOLS.has(String(block.name)),
      )
    ) {
      askedBeforeReading += 1;
    }
  }

  let unrepairedEditFailures = 0;
  let falseUpdateClaims = 0;
  for (const message of messages) {
    if (message.role !== BuilderMessageRole.ASSISTANT) continue;
    const edits = (message.toolResults ?? []).filter((result) =>
      EDIT_TOOLS.has(String(result?.name)),
    );
    let pendingFailures = 0;
    let anySuccess = false;
    for (const edit of edits) {
      if (edit?.result?.ok === false) {
        pendingFailures += 1;
      } else {
        // A later success is taken as the repair. It may have patched a
        // different section; the readiness and the judge catch what it missed.
        pendingFailures = 0;
        anySuccess = true;
      }
    }
    unrepairedEditFailures += pendingFailures;
    if (!anySuccess && CLAIMS_AN_EDIT.test(String(message.content ?? ''))) {
      falseUpdateClaims += 1;
    }
  }

  const row = (key: string) =>
    finalReadiness.sections.find((section) => section.key === key);
  const consistent = ['testPlanRepos', 'requirementHomes', 'mobileTwins'].every(
    (key) => row(key)?.ok !== false,
  );

  return {
    unseenFailures,
    askedBeforeReading,
    unrepairedEditFailures,
    falseUpdateClaims,
    consistent,
    // Absent means the replay never read anything to cite — not a pass.
    evidenceCited: row('existingGrounded')?.ok === true,
  };
}

/** Count of gate failures in a run: every non-zero count, every false flag. */
export function gateViolations(
  gates: BuilderEvalGates | null | undefined,
): number {
  if (!gates) return 0;
  return (
    gates.unseenFailures +
    gates.askedBeforeReading +
    gates.unrepairedEditFailures +
    gates.falseUpdateClaims +
    (gates.consistent ? 0 : 1) +
    (gates.evidenceCited ? 0 : 1)
  );
}
