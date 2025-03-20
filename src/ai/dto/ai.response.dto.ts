import { SummaryNote } from '../../common/entities/type/call.details.type';

export type GenerateSummaryResponse = {
  summary_note: SummaryNote;
  tags: string[];
  call_quality: number;
};

export type EnhanceTextResponse = {
  enhanced_content: string;
};
