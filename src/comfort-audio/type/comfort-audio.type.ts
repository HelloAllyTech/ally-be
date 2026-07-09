import {
  ComfortAudioTrackSortBy,
  ComfortAudioTrackSortOrder,
} from '../dto/get-comfort-audio-tracks.dto';

export type GetComfortAudioTracksOptions = {
  limit?: number;
  offset?: number;
  sortBy?: ComfortAudioTrackSortBy;
  sortOrder?: ComfortAudioTrackSortOrder;
};
