import { Injectable } from '@nestjs/common';
import { RehearsalRun } from '../entity/rehearsal-run.entity';
import { RehearsalTranscript } from '../entity/rehearsal-transcript.entity';
import { RoleplaySpecDocument } from '../type/roleplay-spec-document.type';

const DEFAULT_CHAR_BUDGET = 40_000;
/** Fragments shorter than this are too generic to count as a leak hit. */
const MIN_LEAK_FRAGMENT_CHARS = 25;
const LEAK_WINDOW_TURNS = 2;
const INCONCLUSIVE_TAIL_TURNS = 6;
const DIMENSION_TARGET = 70;

interface TranscriptTurn {
  role?: string;
  content?: string;
  turn_index?: number;
  state_id?: string;
  stage_direction?: string;
}

export interface BuildEvidenceOptions {
  charBudget?: number;
}

/**
 * Condenses a rehearsal's stored transcripts + director traces into the
 * evidence pack the critique (and the copilot's get_rehearsal_findings tool)
 * reads. Pure and deterministic given its inputs.
 *
 * Sections are appended in priority order until the char budget is spent:
 *  1. FAILED test cases — full transcript + evaluator evidence + director timeline
 *  2. INCONCLUSIVE test cases — condition + last turns + timeline
 *  3. Secret-leak windows (POOR/ADVERSARIAL client turns containing locked
 *     secret fragments — the harness's string-containment check, re-run here
 *     so the critic sees the exact leaking exchanges)
 *  4. Difficulty evidence — SKILLED vs POOR state-path timelines
 *  5. Rubric evidence — behaviors the SKILLED run never elicited
 *  6. Judge notes for the lowest-scoring profile
 */
@Injectable()
export class CritiqueEvidenceService {
  buildEvidence(
    run: RehearsalRun,
    transcripts: RehearsalTranscript[],
    spec: Partial<RoleplaySpecDocument>,
    options: BuildEvidenceOptions = {},
  ): string {
    const budget = options.charBudget ?? DEFAULT_CHAR_BUDGET;
    const sections: string[] = [];
    let spent = 0;
    let exhausted = false;

    // Strict priority cutoff: once a section overflows the budget, nothing
    // after it is added either — a low-priority section must never displace
    // a higher-priority one the caller couldn't afford.
    const push = (section: string | null): void => {
      if (!section || exhausted) return;
      const cost = section.length + 2;
      if (spent + cost > budget) {
        exhausted = true;
        return;
      }
      sections.push(section);
      spent += cost;
    };

    const dimensions = (run.results?.dimensions ?? {}) as Record<
      string,
      number
    >;
    const testCaseRows = transcripts.filter((t) => t.agentTestCaseId);
    const profileRows = transcripts.filter((t) => !t.agentTestCaseId);

    for (const row of testCaseRows) {
      const verdict = String(row.testCaseResult?.verdict ?? '');
      if (verdict === 'FAILED') push(this.renderFailedTestCase(run, row));
    }
    for (const row of testCaseRows) {
      const verdict = String(row.testCaseResult?.verdict ?? '');
      if (verdict === 'INCONCLUSIVE') {
        push(this.renderInconclusiveTestCase(run, row));
      }
    }
    if ((dimensions.disclosure_discipline ?? 100) < DIMENSION_TARGET) {
      for (const row of profileRows) {
        if (!['POOR', 'ADVERSARIAL'].includes(row.traineeProfile)) continue;
        push(this.renderLeakWindows(row, spec));
      }
    }
    if ((dimensions.difficulty_calibration ?? 100) < DIMENSION_TARGET) {
      push(this.renderDifficultyEvidence(profileRows));
    }
    if ((dimensions.rubric_coverage ?? 100) < DIMENSION_TARGET) {
      push(this.renderRubricEvidence(profileRows, spec));
    }
    push(this.renderWorstProfileNotes(profileRows));

    return sections.length > 0
      ? sections.join('\n\n')
      : '(no transcript evidence available)';
  }

  // -------------------------------------------------------------- test cases

  private renderFailedTestCase(
    run: RehearsalRun,
    row: RehearsalTranscript,
  ): string {
    const snapshot = this.testCaseSnapshot(run, row.agentTestCaseId);
    const result = row.testCaseResult ?? {};
    const lines = [
      `### FAILED test case: ${result.title ?? snapshot?.title ?? row.agentTestCaseId}`,
      snapshot?.condition ? `Condition: ${snapshot.condition}` : null,
      snapshot?.test ? `Test: ${snapshot.test}` : null,
      result.evidence ? `Evaluator evidence: ${result.evidence}` : null,
      result.reasoning ? `Evaluator reasoning: ${result.reasoning}` : null,
      '',
      this.renderTranscript(row.transcript as TranscriptTurn[]),
      this.renderDirectorTimeline(row),
    ];
    return lines.filter((line) => line !== null).join('\n');
  }

  private renderInconclusiveTestCase(
    run: RehearsalRun,
    row: RehearsalTranscript,
  ): string {
    const snapshot = this.testCaseSnapshot(run, row.agentTestCaseId);
    const turns = (row.transcript ?? []) as TranscriptTurn[];
    const tail = turns.slice(-INCONCLUSIVE_TAIL_TURNS);
    return [
      `### INCONCLUSIVE test case: ${row.testCaseResult?.title ?? snapshot?.title ?? row.agentTestCaseId}`,
      snapshot?.condition
        ? `Condition that never arose: ${snapshot.condition}`
        : null,
      row.testCaseResult?.reasoning
        ? `Evaluator reasoning: ${row.testCaseResult.reasoning}`
        : null,
      '',
      `Last ${tail.length} turns:`,
      this.renderTranscript(tail),
      this.renderDirectorTimeline(row),
    ]
      .filter((line) => line !== null)
      .join('\n');
  }

  private testCaseSnapshot(
    run: RehearsalRun,
    agentTestCaseId?: string | null,
  ): Record<string, any> | undefined {
    const snapshots = (run.config?.testCases ?? []) as Record<string, any>[];
    return snapshots.find((testCase) => testCase.id === agentTestCaseId);
  }

  // -------------------------------------------------------------------- leaks

  /**
   * Same normalization + containment rule the harness's deterministic leak
   * check uses: whole secret content plus each sentence >= 25 chars.
   */
  private renderLeakWindows(
    row: RehearsalTranscript,
    spec: Partial<RoleplaySpecDocument>,
  ): string | null {
    const secrets = spec.disclosureLedger?.secrets ?? [];
    if (secrets.length === 0) return null;
    const turns = (row.transcript ?? []) as TranscriptTurn[];

    const windows: string[] = [];
    for (const secret of secrets) {
      const fragments = this.leakFragments(secret.content ?? '');
      if (fragments.length === 0) continue;
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (String(turn.role).toUpperCase() !== 'CLIENT') continue;
        const haystack = this.normalize(turn.content ?? '');
        if (!fragments.some((fragment) => haystack.includes(fragment))) {
          continue;
        }
        const start = Math.max(0, i - LEAK_WINDOW_TURNS);
        const end = Math.min(turns.length, i + LEAK_WINDOW_TURNS + 1);
        windows.push(
          [
            `Secret "${secret.topic}" (${secret.id}) surfaced at turn ${turn.turn_index ?? i}:`,
            this.renderTranscript(turns.slice(start, end)),
          ].join('\n'),
        );
        break; // one window per secret per profile keeps the pack tight
      }
    }
    if (windows.length === 0) return null;
    return [
      `### Possible leak exchanges (${row.traineeProfile})`,
      ...windows,
    ].join('\n\n');
  }

  private leakFragments(content: string): string[] {
    const whole = this.normalize(content);
    if (!whole) return [];
    const sentences = content
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => this.normalize(sentence))
      .filter((sentence) => sentence.length >= MIN_LEAK_FRAGMENT_CHARS);
    return [whole, ...sentences];
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // --------------------------------------------------------------- difficulty

  private renderDifficultyEvidence(
    profileRows: RehearsalTranscript[],
  ): string | null {
    const relevant = profileRows.filter((row) =>
      ['SKILLED', 'POOR'].includes(row.traineeProfile),
    );
    if (relevant.length === 0) return null;
    const parts = relevant.map((row) => {
      const timeline = this.renderDirectorTimeline(row);
      return [
        `${row.traineeProfile} state progression:`,
        timeline ?? '(no director trace)',
      ].join('\n');
    });
    return ['### Difficulty calibration evidence', ...parts].join('\n\n');
  }

  // -------------------------------------------------------------------- rubric

  private renderRubricEvidence(
    profileRows: RehearsalTranscript[],
    spec: Partial<RoleplaySpecDocument>,
  ): string | null {
    const skilled = profileRows.find((row) => row.traineeProfile === 'SKILLED');
    if (!skilled) return null;
    const observed = new Set<string>();
    for (const event of this.traceEvents(skilled)) {
      if (event.type !== 'director_rubric_score') continue;
      for (const score of (event.scores ?? []) as Record<string, any>[]) {
        if (score.behavior_id) observed.add(String(score.behavior_id));
      }
    }
    const uncovered = (spec.rubric?.behaviors ?? [])
      .filter((behavior) => behavior.polarity === 'helpful')
      .filter((behavior) => !observed.has(behavior.id));
    const lines = [
      '### Rubric coverage evidence (SKILLED run)',
      uncovered.length > 0
        ? `Helpful behaviors never observed: ${uncovered
            .map((behavior) => `${behavior.id} ("${behavior.name}")`)
            .join(', ')}`
        : 'All helpful behaviors were observed at least once.',
    ];
    if (skilled.judgeNotes) {
      lines.push(`Judge notes: ${this.trim(String(skilled.judgeNotes), 1200)}`);
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- judge notes

  private renderWorstProfileNotes(
    profileRows: RehearsalTranscript[],
  ): string | null {
    const scored = profileRows.filter((row) => row.judgeScores);
    if (scored.length === 0) return null;
    const total = (row: RehearsalTranscript): number =>
      Object.values(row.judgeScores ?? {}).reduce(
        (sum: number, value) => sum + (Number(value) || 0),
        0,
      );
    const worst = [...scored].sort((a, b) => total(a) - total(b))[0];
    if (!worst?.judgeNotes) return null;
    return [
      `### Judge notes for the lowest-scoring profile (${worst.traineeProfile})`,
      this.trim(String(worst.judgeNotes), 2000),
    ].join('\n');
  }

  // ------------------------------------------------------------------ helpers

  private renderTranscript(turns: TranscriptTurn[]): string {
    if (!turns || turns.length === 0) return '(empty transcript)';
    return turns
      .map((turn) => {
        const index =
          turn.turn_index !== undefined ? `[${turn.turn_index}] ` : '';
        const state = turn.state_id ? ` (state: ${turn.state_id})` : '';
        return `${index}${turn.role ?? '?'}${state}: ${this.trim(turn.content ?? '', 600)}`;
      })
      .join('\n');
  }

  /**
   * Compressed director timeline: transitions + unlocks + fired events only.
   * Trace entries are FLAT ({type, ...payload}) — see DirectorEmitter._send_sqs
   * in ally-ai-learn (`self.trace.append({"type": message_type, **data})`).
   */
  private renderDirectorTimeline(row: RehearsalTranscript): string | null {
    const events = this.traceEvents(row);
    const lines: string[] = [];
    for (const event of events) {
      switch (event.type) {
        case 'director_state_transition':
          lines.push(
            `turn ${event.turn_index}: state ${event.from_state_id} -> ${event.to_state_id} (guard ${event.guard_id ?? '?'})`,
          );
          break;
        case 'director_disclosure_unlock':
          lines.push(
            `turn ${event.turn_index}: unlocked secret ${event.secret_id}`,
          );
          break;
        case 'director_stage_direction':
          if (event.kind === 'engineered_event') {
            lines.push(
              `turn ${event.turn_index}: engineered event ${event.event_id} fired`,
            );
          }
          break;
        default:
          break;
      }
    }
    if (lines.length === 0) return null;
    return ['Director timeline:', ...lines].join('\n');
  }

  private traceEvents(row: RehearsalTranscript): Record<string, any>[] {
    const trace = row.directorTrace;
    return Array.isArray(trace) ? (trace as Record<string, any>[]) : [];
  }

  private trim(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}
