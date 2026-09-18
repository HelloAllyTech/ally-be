import { BuilderBuildEvent } from '../entity/builder-build-event.entity';

/**
 * What the independent reviewer concluded, written onto the pull request it
 * cleared.
 *
 * Builder already reviews its own work before opening anything: the VERIFY
 * phase is a separate invocation with a fresh context, its own model tier and
 * a read-only tool allowlist, and a pull request cannot open until it passes.
 * That review happened entirely inside the run, so a human arriving at the
 * PR could not see it — they could not tell which requirements were checked,
 * what the reviewer objected to before the coder fixed it, or whether the
 * green tick on the checks meant anything.
 *
 * So this is not a second opinion; it is the first one, made visible. No new
 * model call, no new judgement — it renders events the run already wrote.
 *
 * The gate line matters most of the three. A test suite passing in a tree the
 * agent could edit is only evidence when the agent did not edit the thing that
 * judges it, and the gate now records which kind of pass it was. A reviewer
 * who is told "these tests pass" without being told "and the change rewrote
 * jest.config" has been misled by omission, which is worse than not being
 * told at all.
 */
export function buildVerificationComment(input: {
  verification: BuilderBuildEvent | null;
  gateResults: BuilderBuildEvent[];
  sessionUrl: string;
}): string | null {
  const payload = (input.verification?.payload ?? {}) as Record<string, any>;
  const verdict = payload.verdict === 'fail' ? 'fail' : 'pass';
  const objections: string[] = Array.isArray(payload.objections)
    ? payload.objections.map((entry: unknown) => String(entry)).filter(Boolean)
    : [];
  const checked: string[] = Array.isArray(payload.checkedRequirements)
    ? payload.checkedRequirements
        .map((entry: unknown) => String(entry))
        .filter(Boolean)
    : [];

  // Nothing to say is said by saying nothing. A comment that reports an empty
  // review is noise on every pull request, and teaches a reviewer to skip it.
  if (!input.verification && !input.gateResults.length) return null;

  const lines: string[] = [
    '### Independent review',
    '',
    input.verification
      ? verdict === 'pass'
        ? 'A separate reviewer — fresh context, no memory of writing this — read the diff against the PRD and raised nothing outstanding.'
        : 'The reviewer still had objections when the run ended. Read them before merging.'
      : 'No reviewer verdict was recorded for this run.',
  ];

  if (checked.length) {
    lines.push('', '**Requirements it checked**');
    for (const requirement of checked) lines.push(`- ${requirement}`);
  }

  if (objections.length) {
    lines.push(
      '',
      verdict === 'pass'
        ? '**Raised during the run, then addressed**'
        : '**Outstanding objections**',
    );
    for (const objection of objections) lines.push(`- ${objection}`);
  }

  const untrusted = input.gateResults.filter(
    (event) => (event.payload as Record<string, any>)?.trusted === false,
  );
  if (input.gateResults.length) {
    lines.push('', '**Test gate**');
    if (untrusted.length) {
      const touched = [
        ...new Set(
          untrusted.flatMap(
            (event) =>
              ((event.payload as Record<string, any>)?.configTouched ??
                []) as string[],
          ),
        ),
      ];
      lines.push(
        `Checks passed, but **this change edits the configuration that decides what the checks do** (${touched.join(', ')}), so the pass is not on its own evidence. Read those files first.`,
      );
    } else {
      lines.push(
        'Tests, lint and typecheck ran on a clean tree for every touched repo, and the change did not modify the configuration that decides what they do.',
      );
    }
  }

  lines.push('', `[The PRD and full run log](${input.sessionUrl})`);
  return lines.join('\n');
}
