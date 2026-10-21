/**
 * BRANCHING_SCENARIO ("Branching scenario") component types.
 *
 * A short interactive story: the learner reads a scene, makes a choice, and
 * what happens next depends on that choice — so they live the consequence of a
 * decision instead of being told about it. The canonical use is a counselling
 * conversation where one reply opens the client up and another shuts them down.
 *
 * Shape: a small graph of scenes. Every scene shows text (and optionally one
 * image). A scene with choices asks the learner to pick one; each choice leads
 * to another scene. A scene with no choices is an ending. One decision point
 * is simply a start scene whose choices lead straight to endings; longer
 * stories chain more scenes. Cycles are allowed (a choice may lead back to an
 * earlier scene — "try a different approach"), as long as every scene can
 * still reach an ending.
 *
 * Text and images only. There is no answer key and no score: nothing here is
 * graded, so the whole content can safely ship to the learner as authored.
 * The component completes when the learner reaches any ending, and replaying
 * it afterwards is free.
 */

export enum BranchingOutcomeTone {
  /** The conversation went somewhere good. */
  POSITIVE = 'POSITIVE',
  /** Mixed — some of it landed, some of it didn't. */
  MIXED = 'MIXED',
  /** The conversation went badly. */
  NEGATIVE = 'NEGATIVE',
}

export interface BranchingImage {
  /** An uploaded file (https) — there is no "embed an image" concept. */
  url: string;
  /** What the image shows, for screen readers. */
  alt?: string;
}

export interface BranchingChoice {
  id: string;
  /** What the learner says or does. */
  text: string;
  /** The scene this choice leads to. */
  nextNodeId: string;
}

export interface BranchingNode {
  id: string;
  /** Optional heading for the scene. */
  title?: string;
  /** The scene itself: what the learner sees and hears. */
  text: string;
  image?: BranchingImage;
  /** Absent or empty ⇒ this scene is an ending. */
  choices?: BranchingChoice[];
  /** Endings only: how the story turned out. Shown as a badge. */
  outcome?: BranchingOutcomeTone;
  /** Endings only: 0-100. Defaults from `outcome`; see `branchingEndingScore`. */
  score?: number;
  /** Endings only: the author's reflection on why it went this way. */
  takeaway?: string;
}

export interface BranchingScenarioSettings {
  /** 0-100 required to complete; 0 or absent = ungated. Mirrored into completionCriteria.passScore. */
  passScore?: number;
  /** null / undefined = unlimited attempts. */
  maxAttempts?: number | null;
}

export interface BranchingScenarioContent {
  /** Optional framing shown above the first scene. Translatable. */
  intro?: string;
  settings?: BranchingScenarioSettings;
  startNodeId: string;
  nodes: BranchingNode[];
}

export function isBranchingEnding(node: BranchingNode): boolean {
  return !node.choices || node.choices.length === 0;
}

/**
 * Walk the learner's recorded choices through the authored graph.
 *
 * Returns the ending node id when `choiceIds` is a legal path from the start
 * scene that finishes on an ending, or `null` when any step is not a real
 * choice of the scene the learner was on, or the path stops mid-story.
 */
export function resolveBranchingPath(
  content: BranchingScenarioContent,
  choiceIds: string[],
): string | null {
  const nodesById = new Map(content.nodes.map((node) => [node.id, node]));
  let current = nodesById.get(content.startNodeId);
  for (const choiceId of choiceIds) {
    if (!current) return null;
    const choice = current.choices?.find((c) => c.id === choiceId);
    if (!choice) return null;
    current = nodesById.get(choice.nextNodeId);
  }
  return current && isBranchingEnding(current) ? current.id : null;
}

const OUTCOME_DEFAULT_SCORE: Record<BranchingOutcomeTone, number> = {
  [BranchingOutcomeTone.POSITIVE]: 100,
  [BranchingOutcomeTone.MIXED]: 50,
  [BranchingOutcomeTone.NEGATIVE]: 0,
};

/** The score a run earns for finishing on `node`: its own, else its tone's, else full marks. */
export function branchingEndingScore(node: BranchingNode): number {
  if (typeof node.score === 'number') return node.score;
  if (node.outcome) return OUTCOME_DEFAULT_SCORE[node.outcome];
  return 100;
}
