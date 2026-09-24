/**
 * The parts of a BINARY_CLASSIFIER session event that Event Builder generates
 * from a free-text brief, each from its OWN editable prompt template
 * (src/prompts/event_builder/*.txt) fired as an independent LLM call. The
 * string values double as the prompt-file basename (via
 * toPromptCode('event_builder', <basename>)).
 *
 * Modelled on the Agent Builder Copilot (src/learn/enum/agent-builder-field.enum.ts)
 * — same one-file-per-field, one-call-per-field, parse-server-side shape — but
 * kept separate because the inputs are different (an event brief, not an actor
 * brief) and the outputs are event columns, not scenario columns.
 *
 * Deliberately NOT generated: `detectionConfig` (maxOccurrences, minGapTime,
 * occurrenceInterval, start/end time, min/max score). Those are scenario-pacing
 * decisions that belong to whoever is assembling the simulation, not properties
 * of the behaviour being detected — a model guessing them produces confident
 * noise the author then has to audit.
 */
export enum EventBuilderField {
  /**
   * The event's display name AND the `detectionData.className` the runtime
   * classifies against. One call rather than two: the name is the human label
   * for the same idea the class name states, and generating them apart lets
   * them drift into describing different behaviours.
   * -> { name: string, className: string }
   */
  CLASSIFIER = 'classifier',

  /**
   * Few-shot examples written into `detectionData.positiveExamples` /
   * `negativeExamples`. One call for both polarities because the negatives are
   * only useful when they are NEAR MISSES of the positives — generated
   * separately the model has nothing to contrast against and produces
   * unrelated negatives, which teach the classifier nothing.
   * -> { positiveExamples: [{text}], negativeExamples: [{text}] }
   */
  EXAMPLES = 'examples',

  /**
   * The real-time feedback the learner sees when the event fires, plus the
   * quality-score delta it carries. One unit: an encouraging message with a
   * negative score (or the reverse) is incoherent, so they are decided together.
   * -> { message: string, emoji?: string, score: number }
   */
  FEEDBACK = 'feedback',

  /** How the actor should change behaviour once this fires. -> string */
  BRANCH_INSTRUCTION = 'branch_instruction',

  /** Catalogue tags, so a generated event stays findable. -> string[] */
  TAGS = 'tags',
}

/**
 * Fields whose quality depends on the class name being settled first. The
 * client fires CLASSIFIER, lets the author see (and correct) the result, then
 * fans these out with the resolved `className` — the same one-dependent-step
 * shape the Agent Builder Copilot uses for its per-language fields.
 *
 * Each still generates from the brief alone when `className` is absent, so a
 * caller that wants one flat parallel batch gets a usable answer; it just gets
 * a weaker one.
 */
export const CLASSNAME_DEPENDENT_EVENT_BUILDER_FIELDS: ReadonlySet<EventBuilderField> =
  new Set([
    EventBuilderField.EXAMPLES,
    EventBuilderField.FEEDBACK,
    EventBuilderField.BRANCH_INSTRUCTION,
  ]);

/**
 * Hard ceiling on few-shot examples PER POLARITY.
 *
 * Not a cosmetic limit. ally-ai-learn batches every binary classifier on a
 * simulation into ONE prompt per learner turn
 * (get_batch_binary_classifier_prompt), and each example is inlined into that
 * prompt — so an example is paid for on every turn of every session for the
 * life of the simulation, multiplied by however many classifiers the scenario
 * carries. The studio already warns past 10 advanced events
 * (ADVANCED_EVENTS_LATENCY_THRESHOLD); generation makes adding them nearly
 * free, so the per-event budget has to be bounded here rather than left to
 * whatever the model felt like returning.
 */
export const MAX_EXAMPLES_PER_POLARITY = 5;

/** Examples per polarity when the caller does not ask for a specific count. */
export const DEFAULT_EXAMPLES_PER_POLARITY = 4;

/**
 * Bounds for the generated quality score. Events carry a signed delta — a
 * negative score for a behaviour the learner should avoid — and the studio's
 * score window (minScore/maxScore) is expressed on the same scale.
 */
export const MIN_EVENT_SCORE = -100;
export const MAX_EVENT_SCORE = 100;

/** Catalogue tags per generated event. */
export const MAX_GENERATED_TAGS = 5;
