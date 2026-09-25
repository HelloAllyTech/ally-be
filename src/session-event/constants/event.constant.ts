import { SessionEventDetectionType } from '../enum/session-event-detection.enum';

/**
 * Map of event detection types to their corresponding prefixes.
 * Used for generating event codes.
 */
export const EVENT_TYPE_PREFIX_MAP: Record<SessionEventDetectionType, string> =
  {
    [SessionEventDetectionType.SENTENCE_SIMILARITY]: 'SS',
    [SessionEventDetectionType.SEMANTIC_SIMILARITY]: 'SM',
    [SessionEventDetectionType.TIME]: 'TI',
    [SessionEventDetectionType.SCORE]: 'SC',
    [SessionEventDetectionType.COMBINATION]: 'CO',
    [SessionEventDetectionType.BINARY_CLASSIFIER]: 'BC',
    [SessionEventDetectionType.HELPER_PARAPHRASED]: 'HP',
    [SessionEventDetectionType.HELPER_INTERRUPTED]: 'HI',
    [SessionEventDetectionType.HELPER_UTTERANCE_LENGTH]: 'HL',
  };

/**
 * Maximum depth for recursively resolving nested combination events.
 * Prevents infinite loops and stack overflow in case of circular dependencies.
 */
export const MAX_COMBINATION_EVENT_DEPTH = 20;

/**
 * `detectionData` keys that must be written in the session's language.
 *
 * Everything else in `detectionData` is machinery (scores, times, expression
 * trees) and rides through untranslated — see `extractTranslatableFields`,
 * which splits this object into a translatable half and a passthrough half.
 *
 * `positiveExamples` / `negativeExamples` are the BINARY_CLASSIFIER few-shot
 * block. They MUST be here: the classifier judges an utterance spoken in the
 * session's language, and calibrating that against English examples is the
 * whole failure mode this list exists to prevent. They are also the only
 * entries whose value is not a string or a string array — see
 * DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS.
 */
export const DETECTION_DATA_TRANSLATABLE_PATHS = [
  'sentences',
  'className',
  'positiveExamples',
  'negativeExamples',
];

/**
 * Of the paths above, those whose value is an array of `{ text }` objects
 * rather than a bare string or string array.
 *
 * The translator only speaks strings, so these are unwrapped to `string[]` on
 * the way out and re-wrapped on the way back. Adding a path to
 * DETECTION_DATA_TRANSLATABLE_PATHS without listing it here when its value is
 * shaped like this is a SILENT no-op: extraction accepts only strings and
 * string arrays, so the field is never sent, never translated, and the English
 * original stays in place with nothing to show for it.
 */
export const DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS: ReadonlySet<string> =
  new Set(['positiveExamples', 'negativeExamples']);

export const SYSTEM_EVENT_DETECTION_TYPES = [
  SessionEventDetectionType.HELPER_PARAPHRASED,
  SessionEventDetectionType.HELPER_INTERRUPTED,
  SessionEventDetectionType.HELPER_UTTERANCE_LENGTH,
];

/**
 * Detection types that are retired and can no longer be created. They stay in
 * the SessionEventDetectionType enum (and this array is NOT consulted by
 * read/list/delete paths), so existing events of these types keep reading,
 * listing and soft-deleting exactly as before — only new creation is blocked.
 *
 * SENTENCE_SIMILARITY / SEMANTIC_SIMILARITY — both event types are being
 * deprecated product-wide. ally-ai-learn additionally gates DETECTION (not
 * just creation) of already-configured events of these types via its own
 * SENTENCE_SIMILARITY_DETECTION_ENABLED / SEMANTIC_SIMILARITY_DETECTION_ENABLED
 * settings — this array only stops the problem from growing here.
 */
export const DEPRECATED_EVENT_DETECTION_TYPES: readonly SessionEventDetectionType[] =
  [
    SessionEventDetectionType.SENTENCE_SIMILARITY,
    SessionEventDetectionType.SEMANTIC_SIMILARITY,
  ];
