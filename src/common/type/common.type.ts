export type Pagination = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
};

export type PreferenceValue = {
  fields: Array<string>;
};
