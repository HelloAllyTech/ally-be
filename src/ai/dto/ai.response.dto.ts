import { FlattenedSummaryNotePayload } from '../../common/entities/type/call.details.type';

export type GenerateSummaryResponse = FlattenedSummaryNotePayload;

export type EnhanceTextResponse = {
  enhanced_content: string;
};
