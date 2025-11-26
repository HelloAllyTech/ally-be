import { SessionEventDetectionType } from '../enum/session-event-detection.enum';

export const EVENT_TYPE_PREFIX_MAP: Record<SessionEventDetectionType, string> =
  {
    [SessionEventDetectionType.SENTENCE_SIMILARITY]: 'SS',
    [SessionEventDetectionType.SEMANTIC_SIMILARITY]: 'SM',
    [SessionEventDetectionType.TIME]: 'TI',
    [SessionEventDetectionType.SCORE]: 'SC',
    [SessionEventDetectionType.COMBINATION]: 'CO',
  };
