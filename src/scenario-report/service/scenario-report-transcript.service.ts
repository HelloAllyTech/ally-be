import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScenarioReportTranscript } from '../entity/scenario-report-transcript.entity';
import { ScenarioReportTranscriptResponseDto } from '../dto/scenario-report-transcript.dto';
import { UpdateScenarioReportTranscriptDto } from '../dto/scenario-report-transcript.dto';

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

    const transcriptEntities = transcripts.map((t) =>
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
