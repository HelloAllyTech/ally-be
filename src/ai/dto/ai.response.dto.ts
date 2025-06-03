import {
  FlattenedSummaryNotePayload,
  Tag,
} from '../../common/entities/type/call.details.type';

export type GenerateSummaryResponse = FlattenedSummaryNotePayload;

export type EnhanceTextResponse = {
  enhanced_content: string;
};

export type IdentifySpeakersResponse = {
  [key: string]: string;
};

export type TagPositivityRatingsResponse = {
  tags: Tag[];
};
