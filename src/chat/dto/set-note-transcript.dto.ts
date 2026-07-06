import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Generous upper bound: a long dictation (or several accumulated recordings)
// transcribed to text stays well under this. Guards against an oversized body.
const MAX_TRANSCRIPT_CHARS = 200_000;

/** Body for saving a manual scribe note's dictated transcript. */
export class SetNoteTranscriptDto {
  @ApiProperty({
    description:
      "The dictation transcript to store as the note's transcript. Replaces any previously stored transcript for the note.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TRANSCRIPT_CHARS)
  transcript!: string;
}
