import { BUILDER_HANDOFF_TRANSCRIPT_MAX } from '../constants/product-roadmap.constants';
import {
  RoadmapFilingInterviewMessage,
  RoadmapOpportunityBrief,
} from '../type/roadmap-brief.type';

/** The parts of an opportunity a Builder session is handed when it starts from one. */
export interface BuilderHandoffSource {
  code?: string | null;
  description: string;
  prd?: string | null;
  brief?: RoadmapOpportunityBrief | null;
  interviewTranscript?: RoadmapFilingInterviewMessage[] | null;
}

/**
 * Everything the roadmap knows about an opportunity, written for the Builder interview that
 * picks it up — the opportunity, the copilot's brief and the filing interview itself.
 *
 * WHY ALL THREE. The description is the votable one-paragraph summary; most of what the
 * filing interview decided never reaches it. A live session handed only the description spent
 * its opening questions on what the filer had already settled with the copilot — whether
 * debrief feedback sits beside the existing session rating, and the rating's shape — both
 * recorded in the brief it was never shown. The brief is the copilot's distillation; the
 * transcript is what was actually said, including decisions no brief field has a slot for.
 * Stacks, "Bridging Design and Development Through Early Alignment": hand over the reasoning
 * behind a design, not only the design, so whoever builds it keeps the intent when they have
 * to change something.
 *
 * Every section is omitted when empty rather than rendered blank — an empty "Evidence"
 * heading reads to the agent as "evidence was looked for and none exists", which is a
 * different fact from "nobody looked".
 */
export const renderBuilderHandoff = (source: BuilderHandoffSource): string => {
  const sections: string[] = [
    `## The opportunity${source.code ? ` (${source.code})` : ''}, as filed on the roadmap\n\n${source.description.trim()}`,
  ];
  if (source.prd?.trim()) {
    sections.push(`## PRD notes on the opportunity\n\n${source.prd.trim()}`);
  }
  if (source.brief) sections.push(renderBrief(source.brief));
  const transcript = renderTranscript(source.interviewTranscript ?? []);
  if (transcript) sections.push(transcript);
  return sections.join('\n\n');
};

/** What the hand-off carries beyond the description, for the seed's one-line pointer to it. */
export const describeBuilderHandoff = (
  source: BuilderHandoffSource,
): { hasBrief: boolean; interviewMessages: number } => ({
  hasBrief: !!source.brief,
  interviewMessages: source.interviewTranscript?.length ?? 0,
});

const bullets = (items: string[]): string =>
  items.map((item) => `- ${item}`).join('\n');

const renderBrief = (brief: RoadmapOpportunityBrief): string => {
  const parts: string[] = [
    "## The opportunity copilot's brief\n\nThe case the copilot built with the admin while " +
      'filing this, as it stood at filing.',
  ];

  const { assessment } = brief;
  const verdict = [
    `**Copilot's assessment:** ${assessment.rating.replace('_', ' ')}`,
    assessment.summary ? ` — ${assessment.summary}` : '',
  ].join('');
  parts.push(
    assessment.openRecommendations.length
      ? `${verdict}\n\nWhat it said would strengthen the case:\n${bullets(assessment.openRecommendations)}`
      : verdict,
  );

  if (brief.strategicFit.length) {
    parts.push(
      `**Strategic fit**\n${bullets(brief.strategicFit.map((fit) => `${fit.goal}: ${fit.why}`))}`,
    );
  }
  const reach = [
    brief.reach.howMany ? `how many: ${brief.reach.howMany}` : null,
    brief.reach.howOften ? `how often: ${brief.reach.howOften}` : null,
  ].filter(Boolean);
  if (reach.length) parts.push(`**Reach** — ${reach.join('; ')}`);
  if (brief.successMetric) {
    parts.push(`**Success metric:** ${brief.successMetric}`);
  }
  if (brief.evidence.length) {
    parts.push(
      '**Evidence already gathered** — start from these references rather than searching ' +
        `again:\n${bullets(
          brief.evidence.map(
            (item) =>
              `[${item.source}] ${item.claim}${item.ref ? ` (${item.ref})` : ''}`,
          ),
        )}`,
    );
  }
  if (brief.assumptions.length) {
    parts.push(
      '**Leap-of-faith assumptions** — most important to the case, weakest evidence behind ' +
        `them:\n${bullets(brief.assumptions)}`,
    );
  }
  if (brief.alternativesDropped.length) {
    parts.push(
      `**Alternatives considered and dropped**\n${bullets(brief.alternativesDropped)}`,
    );
  }
  return parts.join('\n\n');
};

/**
 * The conversation, speaker-labelled, within BUILDER_HANDOFF_TRANSCRIPT_MAX.
 *
 * `COPILOT`, not `YOU`: the reader is Builder, which did not ask these questions, and a
 * transcript that labelled them as its own would have it treat them as its turns. Over budget,
 * it keeps the opening exchange — the copilot's first question and the admin's original ask —
 * plus as many of the latest messages as fit, which is where the decisions land, and says
 * how many it left out between them.
 */
const renderTranscript = (
  messages: RoadmapFilingInterviewMessage[],
): string | null => {
  if (!messages.length) return null;
  const lines = messages.map(
    (message) =>
      `${message.role === 'admin' ? 'ADMIN' : 'COPILOT'}: ${message.content.trim()}`,
  );
  const size = (items: string[]) =>
    items.reduce((total, line) => total + line.length + 2, 0);

  let kept = lines;
  let omitted = 0;
  if (size(lines) > BUILDER_HANDOFF_TRANSCRIPT_MAX) {
    const head = lines.slice(0, 2);
    let room = BUILDER_HANDOFF_TRANSCRIPT_MAX - size(head);
    const tail: string[] = [];
    for (let index = lines.length - 1; index >= head.length; index--) {
      const cost = lines[index].length + 2;
      if (cost > room) break;
      tail.unshift(lines[index]);
      room -= cost;
    }
    omitted = lines.length - head.length - tail.length;
    kept = [
      ...head,
      `[… ${omitted} message${omitted === 1 ? '' : 's'} omitted for length …]`,
      ...tail,
    ];
  }

  return [
    '## The filing interview, verbatim',
    `The conversation in which the admin filed this opportunity with the roadmap's ` +
      `opportunity copilot (COPILOT), ${messages.length} messages${
        omitted ? `, ${omitted} of them omitted below` : ''
      }. COPILOT is not you.`,
    kept.join('\n\n'),
  ].join('\n\n');
};
