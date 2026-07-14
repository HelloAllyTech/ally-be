import {
  ComfortAudioTrackSortBy,
  ComfortAudioTrackSortOrder,
} from '../dto/get-comfort-audio-tracks.dto';

export type GetComfortAudioTracksOptions = {
  limit?: number;
  offset?: number;
  sortBy?: ComfortAudioTrackSortBy;
  sortOrder?: ComfortAudioTrackSortOrder;
  /** When false (default), archived tracks are excluded. */
  includeArchived?: boolean;
};
