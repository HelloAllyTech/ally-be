import { Request } from 'express';
export type Pagination = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
};

export type ScenarioFilters = {
  status?: string;
  tenantId?: string;
  search?: string;
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

export type HiddenChatTypesPreferenceValue = Array<string>;

export type PreferenceValue =
  | SummaryPreferenceValue
  | NudgePreferenceValue
  | HiddenChatTypesPreferenceValue;

export type RequestWithUser = Request & {
  user?: {
    id: number;
    role: string;
    tenantId: string;
  };
};

export type SuccessResponse = {
  success: boolean;
};
