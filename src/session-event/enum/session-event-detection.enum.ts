export enum SessionEventDetectionType {
  SENTENCE_SIMILARITY = 'SENTENCE_SIMILARITY',
  SEMANTIC_SIMILARITY = 'SEMANTIC_SIMILARITY',
  TIME = 'TIME',
  SCORE = 'SCORE',
  COMBINATION = 'COMBINATION',
}

export enum SessionEventDetectionCondition {
  LT = 'LT',
  GT = 'GT',
  EQ = 'EQ',
  LTE = 'LTE',
  GTE = 'GTE',
}
