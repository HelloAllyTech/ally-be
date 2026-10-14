import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  TRACK_DEFAULT_ANNOTATION_FALSE_POSITIVE_PENALTY,
  TRACK_DEFAULT_ANNOTATION_PASS_SCORE,
} from 'src/track/constants/track.constant';
import {
  AnnotationArtifactKind,
  AnnotationContent,
  AnnotationLabel,
  AnnotationRevealKey,
  AnnotationSwatch,
  AnnotationTarget,
  AnnotationUnit,
  markKey,
} from 'src/track/type/annotation.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBrief } from '../../type/course-copilot.type';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ItemSpecialist,
  SpecialistContext,
  SpecialistOutput,
} from './specialist.types';
import {
  asArray,
  asText,
  assertNoProblems,
  assertTrackItemContent,
  briefForPrompt,
  clampInt,
  collectContentIds,
  courseOutlineForPrompt,
  describeItemForPrompt,
  foldText,
  IdMinter,
  isRecord,
  itemForPrompt,
  nextPracticeInSection,
  objectivesForPrompt,
  plural,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

type Polarity = 'helpful' | 'unhelpful' | 'neutral';

/**
 * Swatches by meaning, so a course's labels read the same way everywhere:
 * cool colours for what to do, warm for what to avoid. The frontends never
 * rely on colour alone (see `AnnotationSwatch`), so this is a convention,
 * not the signal.
 */
const SWATCH_PREFERENCE: Record<Polarity, AnnotationSwatch[]> = {
  helpful: [
    AnnotationSwatch.GREEN,
    AnnotationSwatch.TEAL,
    AnnotationSwatch.BLUE,
  ],
  unhelpful: [
    AnnotationSwatch.ROSE,
    AnnotationSwatch.ORANGE,
    AnnotationSwatch.AMBER,
  ],
  neutral: [AnnotationSwatch.VIOLET, AnnotationSwatch.SLATE],
};

const SPEAKER_PREFIX = /^([A-Z][\p{L}\p{M} .'-]{0,30}):\s+([\s\S]+)$/u;
const UNIT_TEXT_MAX_CHARS = 1_000;
const NOTE_MAX_CHARS = 400;

interface AnnotationNormaliseOptions {
  title: string;
  passScore: number;
  brief: CourseBrief;
  keepIds: ReadonlySet<string>;
}

/**
 * Writes one ANNOTATED_ARTIFACT item: a fictional helper conversation the
 * learner marks with helpful and unhelpful behaviour labels.
 *
 * Stacks: "Completion Strategy: Sequencing from Worked Examples to Independent
 * Problems" — this is the worked example placed before the first roleplay on
 * the same behaviours, so the prompt is told which roleplay comes next.
 * "Deep Processing and Comparison in Case Study Design" — a worked example
 * teaches when it provokes comparison, so the transcript mixes helpful and
 * unhelpful moments (labels have to be discriminated, not sprayed), the intro
 * poses the question to hold while reading, and every answer carries a note
 * explaining the line's effect on the person — the reveal is the lesson.
 *
 * Label wording is snapped to the brief's confirmed behaviour names wherever
 * the model paraphrased one, so the transcript, the roleplay rubric and the
 * course's competencies talk about the same behaviours in the same words.
 */
@Injectable()
export class AnnotationSpecialist implements ItemSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(context: SpecialistContext): Promise<SpecialistOutput> {
    const { brief, blueprint, item, previous } = context;
    const spec = item.spec ?? {};
    const helpful = (brief?.behaviours?.helpful ?? []).filter(Boolean);
    const unhelpful = (brief?.behaviours?.unhelpful ?? []).filter(Boolean);
    const chosen = asArray(spec.behaviourLabels)
      .map((label) => asText(label))
      .filter(Boolean);
    const next = nextPracticeInSection(blueprint, item.id);
    const lineCount = spec.lineCount
      ? String(
          clampInt(
            spec.lineCount,
            8,
            COURSE_COPILOT_LIMITS.annotationUnits,
            30,
          ),
        )
      : `20-40 (never more than ${COURSE_COPILOT_LIMITS.annotationUnits})`;

    const { data } = await this.llm.runJson({
      specialist: 'annotation',
      promptCode: COURSE_COPILOT_PROMPTS.ANNOTATION_WRITER,
      taskId: COURSE_COPILOT_AI_TASKS.ANNOTATION,
      task: LlmTask.COURSE_COPILOT_ANNOTATION,
      maxTokens: SPECIALIST_MAX_TOKENS.ANNOTATION,
      usageMetadata: context.usageMetadata,
      repairErrors: context.repairErrors,
      previous,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint, item.id),
        item_json: itemForPrompt(item),
        objectives: objectivesForPrompt(brief, item),
        helpful_behaviours: helpful.length
          ? helpful.map((behaviour) => `- ${behaviour}`).join('\n')
          : '- (none confirmed — name them yourself)',
        unhelpful_behaviours: unhelpful.length
          ? unhelpful.map((behaviour) => `- ${behaviour}`).join('\n')
          : '- (none confirmed — name them yourself)',
        label_instruction: chosen.length
          ? `The course plan picked these labels for this transcript — use them, worded exactly so: ${chosen.join('; ')}.`
          : `Pick the ${COURSE_COPILOT_LIMITS.annotationLabels} or fewer behaviours from the lists above that this conversation can show most clearly.`,
        next_practice: next
          ? describeItemForPrompt(next)
          : 'No roleplay follows in this section; write the conversation the outcomes above describe.',
        line_count: lineCount,
        max_labels: String(COURSE_COPILOT_LIMITS.annotationLabels),
      },
    });

    return normaliseAnnotationOutput(data, {
      title: item.title,
      passScore: clampInt(
        item.completionCriteria?.passScore,
        0,
        100,
        TRACK_DEFAULT_ANNOTATION_PASS_SCORE,
      ),
      brief,
      keepIds: previous ? collectContentIds(previous.content) : new Set(),
    });
  }
}

/** Pure: raw model JSON → validated ANNOTATED_ARTIFACT content. Exported for tests. */
export function normaliseAnnotationOutput(
  raw: Record<string, any>,
  opts: AnnotationNormaliseOptions,
): SpecialistOutput {
  const root = isRecord(raw.annotation) ? raw.annotation : raw;
  const ids = new IdMinter(opts.keepIds);
  const problems: string[] = [];

  // ── Units ───────────────────────────────────────────────────────────────
  const unitIds = new Map<string, string>();
  const units: AnnotationUnit[] = [];
  for (const rawUnit of asArray(root.units ?? root.lines)) {
    if (units.length >= COURSE_COPILOT_LIMITS.annotationUnits) break;
    const entry = isRecord(rawUnit) ? rawUnit : { text: rawUnit };
    let text = asText(entry.text ?? entry.line).slice(0, UNIT_TEXT_MAX_CHARS);
    let speaker = asText(entry.speaker, 60);
    if (!speaker) {
      const prefixed = SPEAKER_PREFIX.exec(text);
      if (prefixed) {
        speaker = prefixed[1].trim();
        text = prefixed[2].trim();
      }
    }
    if (!text) continue;
    const id = ids.mint(entry.id);
    const rawId = asText(entry.id);
    if (rawId && !unitIds.has(rawId)) unitIds.set(rawId, id);
    units.push({ id, ...(speaker ? { speaker } : {}), text });
  }
  if (!units.length) problems.push('The transcript has no lines.');

  // ── Labels ──────────────────────────────────────────────────────────────
  const labelIds = new Map<string, string>();
  const labels: (AnnotationLabel & { polarity: Polarity })[] = [];
  const seenLabelText = new Set<string>();
  for (const rawLabel of asArray(root.labels).filter(isRecord)) {
    if (labels.length >= COURSE_COPILOT_LIMITS.annotationLabels) break;
    const snapped = snapToBehaviour(
      asText(rawLabel.text ?? rawLabel.name),
      opts.brief,
    );
    if (!snapped.text || seenLabelText.has(foldText(snapped.text))) continue;
    seenLabelText.add(foldText(snapped.text));
    const id = ids.mint(rawLabel.id);
    for (const key of [
      asText(rawLabel.id),
      asText(rawLabel.text ?? rawLabel.name),
    ]) {
      if (key && !labelIds.has(key)) labelIds.set(key, id);
    }
    const declared = asText(rawLabel.polarity).toLowerCase();
    const polarity: Polarity =
      snapped.polarity ??
      (declared === 'helpful' || declared === 'unhelpful'
        ? declared
        : 'neutral');
    const label: AnnotationLabel & { polarity: Polarity } = {
      id,
      text: snapped.text.slice(0, 80),
      color: AnnotationSwatch.SLATE,
      polarity,
    };
    const description = asText(rawLabel.description, 200);
    if (description) label.description = description;
    labels.push(label);
  }
  if (!labels.length) problems.push('The exercise has no labels.');
  assignSwatches(labels);

  // ── Targets ─────────────────────────────────────────────────────────────
  const targets: AnnotationTarget[] = [];
  const seenTargets = new Set<string>();
  for (const rawTarget of asArray(root.targets ?? root.answers).filter(
    isRecord,
  )) {
    const unitId = unitIds.get(asText(rawTarget.unitId ?? rawTarget.unit));
    const labelId = labelIds.get(asText(rawTarget.labelId ?? rawTarget.label));
    if (!unitId || !labelId) continue;
    const key = markKey(unitId, labelId);
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    const target: AnnotationTarget = { unitId, labelId };
    const note = asText(
      rawTarget.note ?? rawTarget.explanation,
      NOTE_MAX_CHARS,
    );
    if (note) target.note = note;
    targets.push(target);
  }
  if (units.length && labels.length && !targets.length) {
    problems.push(
      'The answer key is empty — every target must pair a line id from "units" with a label id from "labels".',
    );
  }
  assertNoProblems(problems);

  const content: AnnotationContent = {
    kind: AnnotationArtifactKind.TRANSCRIPT,
    ...(asText(root.intro) ? { intro: asText(root.intro, 400) } : {}),
    units,
    // `polarity` only chose the swatch; it is not part of the stored label.
    labels: labels.map((label) => {
      const stored: AnnotationLabel = {
        id: label.id,
        text: label.text,
        color: label.color,
      };
      if (label.description) stored.description = label.description;
      return stored;
    }),
    targets,
    settings: {
      passScore: opts.passScore,
      maxAttempts: null,
      falsePositivePenalty: TRACK_DEFAULT_ANNOTATION_FALSE_POSITIVE_PENALTY,
      revealKey: AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
    },
  };
  assertTrackItemContent(TrackItemType.ANNOTATED_ARTIFACT, content, opts.title);

  return {
    content: content as unknown as Record<string, any>,
    summary: [
      plural(units.length, 'line'),
      plural(labels.length, 'label'),
      plural(targets.length, 'answer'),
    ].join(' · '),
  };
}

/** The brief's exact wording for a behaviour the model paraphrased, if any. */
function snapToBehaviour(
  text: string,
  brief: CourseBrief,
): { text: string; polarity?: Polarity } {
  const wanted = foldText(text);
  if (!wanted) return { text: '' };
  const lists: [Polarity, string[]][] = [
    ['helpful', brief?.behaviours?.helpful ?? []],
    ['unhelpful', brief?.behaviours?.unhelpful ?? []],
  ];
  for (const exact of [true, false]) {
    for (const [polarity, behaviours] of lists) {
      for (const behaviour of behaviours) {
        const candidate = foldText(behaviour ?? '');
        if (!candidate) continue;
        const matches = exact
          ? candidate === wanted
          : candidate.includes(wanted) || wanted.includes(candidate);
        if (matches) return { text: behaviour.trim(), polarity };
      }
    }
  }
  return { text };
}

function assignSwatches(
  labels: { color: AnnotationSwatch; polarity: Polarity }[],
): void {
  const used = new Set<AnnotationSwatch>();
  const all = Object.values(AnnotationSwatch);
  for (const label of labels) {
    const colour =
      SWATCH_PREFERENCE[label.polarity].find((swatch) => !used.has(swatch)) ??
      all.find((swatch) => !used.has(swatch)) ??
      AnnotationSwatch.SLATE;
    used.add(colour);
    label.color = colour;
  }
}
