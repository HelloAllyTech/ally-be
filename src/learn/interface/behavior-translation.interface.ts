export interface CreateBehaviorTranslation {
  behaviorId: string;
  languageId: number;
  name: string;
}

export interface UpdateBehaviorTranslation extends CreateBehaviorTranslation {}
