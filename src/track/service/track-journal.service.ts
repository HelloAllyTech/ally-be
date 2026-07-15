import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { JournalContent, TrackItemType } from '../type/track.type';
import { TrackJournalEntryRepository } from '../repository/track-journal-entry.repository';
import { TrackEnrollmentService } from './track-enrollment.service';
import { TrackProgressService } from './track-progress.service';

@Injectable()
export class TrackJournalService {
  private readonly logger = LoggerService.getInstance(TrackJournalService.name);

  constructor(
    private readonly trackJournalEntryRepository: TrackJournalEntryRepository,
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly trackProgressService: TrackProgressService,
  ) {}

  /** Draft upsert — mirrors the reflection-tab autosave pattern. */
  async saveDrafts(
    trackItemId: string,
    responses: { promptId: string; response: string }[],
  ) {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.JOURNAL) {
      throw new BadRequestException('This component is not a journal');
    }
    const journal = item.content as JournalContent;
    const promptIds = new Set(journal.prompts.map((prompt) => prompt.id));

    for (const entry of responses) {
      if (!promptIds.has(entry.promptId)) {
        throw new BadRequestException(
          `Unknown journal prompt: ${entry.promptId}`,
        );
      }
      const existing = await this.trackJournalEntryRepository.findOne({
        where: { trackItemProgressId: progress.id, promptId: entry.promptId },
      });
      await this.trackJournalEntryRepository.save({
        ...(existing ? { id: existing.id } : {}),
        trackItemProgressId: progress.id,
        trackItemId: item.id,
        userId: progress.userId,
        promptId: entry.promptId,
        response: entry.response,
      });
    }
    return { success: true };
  }

  /** Validate required prompts are answered, stamp, and complete the item. */
  async submit(trackItemId: string) {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.JOURNAL) {
      throw new BadRequestException('This component is not a journal');
    }
    const journal = item.content as JournalContent;
    const entries = await this.trackJournalEntryRepository.findByProgressId(
      progress.id,
    );
    const responseByPromptId = new Map(
      entries.map((entry) => [entry.promptId, entry.response]),
    );

    for (const prompt of journal.prompts) {
      const required = prompt.required !== false;
      const response = (responseByPromptId.get(prompt.id) ?? '').trim();
      if (required && !response) {
        throw new BadRequestException(
          'Please answer all required prompts before submitting.',
        );
      }
    }

    const now = new Date();
    for (const entry of entries) {
      if (!entry.submittedAt) {
        await this.trackJournalEntryRepository.update(entry.id, {
          submittedAt: now,
        });
      }
    }
    const completion = await this.trackProgressService.completeItem(
      progress.id,
      {},
    );
    this.logger.info(`Journal submitted for track item ${trackItemId}`);
    return completion;
  }
}
