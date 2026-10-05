import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScenarioReportTranscript } from '../entity/scenario-report-transcript.entity';
import { ScenarioReportTranscriptResponseDto } from '../dto/scenario-report-transcript.dto';
import { UpdateScenarioReportTranscriptDto } from '../dto/scenario-report-transcript.dto';

/** One turn's identity: when it was said, by whom, and what. */
function transcriptKey(
  startSeconds: number | null | undefined,
  role: string,
  content: string,
): string {
  return JSON.stringify([startSeconds ?? null, role, content]);
}

@Injectable()
export class ScenarioReportTranscriptService {
  constructor(
    @InjectRepository(ScenarioReportTranscript)
    private readonly scenarioReportTranscriptRepository: Repository<ScenarioReportTranscript>,
  ) {}

  async addTranscripts(
    reportId: string,
    transcripts: UpdateScenarioReportTranscriptDto[],
  ): Promise<void> {
    if (transcripts.length === 0) return;

    // The same webhook can arrive twice: ai-learn retries a report webhook
    // that failed with a 5xx or a dropped connection, and the first attempt
    // may already have saved its turns (a gateway timeout after the write,
    // say). Skip any turn this report already holds, so a retry never shows
    // the same line twice in the Studio transcript.
    const existing = await this.scenarioReportTranscriptRepository.find({
      where: { scenarioReportId: reportId },
      select: ['startSeconds', 'role', 'content'],
    });
    const seen = new Set(
      existing.map((t) => transcriptKey(t.startSeconds, t.role, t.content)),
    );
    const fresh = transcripts.filter((t) => {
      const key = transcriptKey(t.start_time, t.role, t.content);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) return;

    const transcriptEntities = fresh.map((t) =>
      this.scenarioReportTranscriptRepository.create({
        scenarioReportId: reportId,
        content: t.content,
        startSeconds: t.start_time,
        role: t.role,
      }),
    );
    await this.scenarioReportTranscriptRepository.save(transcriptEntities);
  }

  async getScenarioReportTranscripts(
    reportId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ScenarioReportTranscriptResponseDto> {
    const [transcript, count] =
      await this.scenarioReportTranscriptRepository.findAndCount({
        where: { scenarioReportId: reportId },
        order: {
          startSeconds: 'ASC',
        },
        ...(options?.limit !== undefined && { take: options.limit }),
        ...(options?.offset !== undefined && { skip: options.offset }),
      });
    return {
      messages: transcript,
      count,
    };
  }
}
