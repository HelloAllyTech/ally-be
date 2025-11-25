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

export enum CombinationExpressionType {
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  IDENTIFIER = 'IDENTIFIER',
}

export enum CombinationExpressionRequestType {
  AND = CombinationExpressionType.AND,
  OR = CombinationExpressionType.OR,
  NOT = CombinationExpressionType.NOT,
}
