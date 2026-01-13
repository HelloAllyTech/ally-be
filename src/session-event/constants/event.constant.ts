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

export const DETECTION_DATA_TRANSLATABLE_PATHS = ['sentences', 'className'];

export const SYSTEM_EVENT_DETECTION_TYPES = [
  SessionEventDetectionType.HELPER_PARAPHRASED,
  SessionEventDetectionType.HELPER_INTERRUPTED,
  SessionEventDetectionType.HELPER_UTTERANCE_LENGTH,
];
