export const ENDPOINTS = {
  SUMMARY: 'api/v1/summary/note',
  CONVERSATION: 'api/v1/conversation/analyze',
  ENHANCE: 'api/v1/summary/enhance',
  IDENTIFY_SPEAKERS: 'api/v1/conversation/identify',
  TAG_POSITIVITY_RATINGS: 'api/v1/summary/tag-positivity-ratings',
  ADD_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  SEARCH_REFERENCE_DOCUMENTS: 'api/v1/reference-documents/search',
  UPDATE_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  GET_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  DELETE_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  TRANSCRIBE_AND_SUMMARIZE: 'api/v1/transcribe-and-summarize',
} as const;
