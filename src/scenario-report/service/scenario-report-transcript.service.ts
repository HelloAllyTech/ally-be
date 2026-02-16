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
        startSeconds: t.startSeconds,
        endSeconds: t.endSeconds,
        sender: t.sender,
      }),
    );
    await this.scenarioReportTranscriptRepository.save(transcriptEntities);
  }

  async getScenarioReportTranscripts(
    reportId: string,
  ): Promise<ScenarioReportTranscriptResponseDto> {
    const [transcript, count] =
      await this.scenarioReportTranscriptRepository.findAndCount({
        where: { scenarioReportId: reportId },
      });
    return {
      messages: transcript,
      count,
    };
  }
}
