import { ApiProperty } from '@nestjs/swagger';

/**
 * The kinds of form field the voice-note extractor understands. The frontend
 * maps its own field model (built-in summary fields + org custom fields) onto
 * these generic, human-readable types before sending them; the backend never
 * needs to know about summary keys or custom-field encodings.
 */
export type VoiceNoteFieldType =
  | 'text'
  | 'multiline'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'boolean';

/**
 * One target field the LLM should try to fill from the transcript. `options`
 * are the human-readable choice labels for `select`/`multiselect` fields.
 */
export interface VoiceNoteFieldSpec {
  id: string;
  label: string;
  type: VoiceNoteFieldType;
  options?: string[];
  hint?: string;
}

/** A single extracted field value (value is always a human-readable string). */
export class VoiceNoteFieldValueDto {
  @ApiProperty({ description: 'The field id echoed from the request.' })
  id!: string;

  @ApiProperty({ description: 'The extracted, human-readable value.' })
  value!: string;
}

export class GenerateNoteFromAudioResponseDto {
  @ApiProperty({
    description:
      'Plain-text transcript of the dictation. Not persisted server-side.',
  })
  transcript!: string;

  @ApiProperty({
    type: [VoiceNoteFieldValueDto],
    description: 'Values the model could confidently fill from the transcript.',
  })
  values!: VoiceNoteFieldValueDto[];
}
