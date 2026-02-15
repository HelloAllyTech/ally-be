import {
  ScenarioCoverImageLibrarySortBy,
  ScenarioCoverImageLibrarySortOrder,
} from '../dto/get-scenario-cover-image-library.dto';

export type GetScenarioCoverImageLibraryOptions = {
  limit?: number;
  offset?: number;
  sortBy?: ScenarioCoverImageLibrarySortBy;
  sortOrder?: ScenarioCoverImageLibrarySortOrder;
};
