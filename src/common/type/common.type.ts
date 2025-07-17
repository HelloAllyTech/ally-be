export type Pagination = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
};

export class PaginatedResponse<T> {
  data!: T[];
  count!: number;
}

export type NudgePreferenceValue = {
  status: boolean;
};

export type SummaryPreferenceValue = {
  fields: Array<string>;
};

export type HiddenChatTypesPreferenceValue = string[];

export type PreferenceValue =
  | SummaryPreferenceValue
  | NudgePreferenceValue
  | HiddenChatTypesPreferenceValue;
