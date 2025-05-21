export type Pagination = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
};

export type NudgePreferenceValue = {
  status: boolean;
};

export type SummaryPreferenceValue = {
  fields: Array<string>;
};

export type PreferenceValue = SummaryPreferenceValue | NudgePreferenceValue;
