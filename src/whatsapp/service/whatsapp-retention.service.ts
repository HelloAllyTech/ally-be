import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../entity/wa-unanswered-question.entity';
import { WhatsAppSettingsService } from './whatsapp-settings.service';

/** Rows blanked per pass. Bounds one run's transaction size on a large backlog. */
const BATCH_SIZE = 500;

/**
 * Ages out identifiable content while keeping the aggregates.
 *
 * Masking in the admin UI limits who sees a phone number; this limits how long one exists at all,
 * which is the only mitigation that survives a database dump or a support engineer with read access.
 *
 * What it does NOT do is delete rows. Deleting them would silently rewrite historical usage figures —
 * an operator comparing this quarter against last would see last quarter's volume shrink every month
 * as the window rolled. So bodies and numbers are blanked in place and the counts stay put, exactly
 * as the manual per-contact erasure does.
 *
 * Idempotent by construction: the query only selects rows whose body is not already the placeholder,
 * so a re-run over the same window is a no-op rather than a second pass of writes.
 */
@Injectable()
export class WhatsAppRetentionService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppRetentionService.name,
  );

  constructor(
    @InjectRepository(WaMessage)
    private readonly messageRepository: Repository<WaMessage>,
    @InjectRepository(WaContact)
    private readonly contactRepository: Repository<WaContact>,
    @InjectRepository(WaConversation)
    private readonly conversationRepository: Repository<WaConversation>,
    @InjectRepository(WaUnansweredQuestion)
    private readonly unansweredRepository: Repository<WaUnansweredQuestion>,
    private readonly settingsService: WhatsAppSettingsService,
  ) {}

  /** Entry point for the daily scheduled task. */
  async runRetentionSweep(): Promise<void> {
    const settings = await this.settingsService.get();
    const days = settings.retentionDays;

    // 0 disables the sweep. An operator may genuinely need that during a pilot, so it is an explicit
    // off switch rather than something expressed by setting the window absurdly long.
    if (!days || days <= 0) {
      this.logger.debug(
        'WhatsApp retention sweep disabled (retentionDays = 0)',
      );
      return;
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const messages = await this.messageRepository.count({
      where: { createdAt: LessThan(cutoff), body: Not(ERASED) },
    });
    if (messages === 0) {
      this.logger.debug('WhatsApp retention sweep: nothing past the cutoff');
      return;
    }

    const blanked = await this.blankMessages(cutoff);
    const questions = await this.blankQuestions(cutoff);
    const contacts = await this.blankOrphanedContacts(cutoff);

    // Logged at info, not debug: a retention job that quietly does nothing for six months is
    // indistinguishable from one that is working, and this is the record that says which.
    this.logger.info(
      `WhatsApp retention sweep past ${cutoff.toISOString()}: ` +
        `${blanked} message(s), ${questions} question(s), ${contacts} contact(s)`,
    );
  }

  private async blankMessages(cutoff: Date): Promise<number> {
    // Batched with a bounded loop rather than one statement: the first run after this ships may face
    // the entire history at once, and a single UPDATE over it would hold locks for as long as it takes.
    let total = 0;
    for (;;) {
      const batch = await this.messageRepository.find({
        where: { createdAt: LessThan(cutoff), body: Not(ERASED) },
        select: ['id'],
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      await this.messageRepository.update(
        { id: In(batch.map((row) => row.id)) },
        // The citation array goes too: it names document ids and page numbers against a specific
        // worker's question, which is the association being aged out, not the document itself.
        { body: ERASED, citations: null, retrievalMeta: null },
      );
      total += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }
    return total;
  }

  private async blankQuestions(cutoff: Date): Promise<number> {
    const result = await this.unansweredRepository.update(
      { createdAt: LessThan(cutoff), questionText: Not(ERASED) },
      { questionText: ERASED },
    );
    return result.affected ?? 0;
  }

  /**
   * Blank the number of any contact whose last activity is past the cutoff.
   *
   * Keyed on the CONVERSATION's last message rather than the contact's own `lastSeenAt`, because a
   * contact who messaged once a year ago and again yesterday must keep their number: the recent thread
   * is still within the window, and an admin may still need to act on it.
   */
  private async blankOrphanedContacts(cutoff: Date): Promise<number> {
    const stale = await this.conversationRepository
      .createQueryBuilder('c')
      .select('c.contact_id', 'contactId')
      .groupBy('c.contact_id')
      .having('MAX(c.last_message_at) < :cutoff', { cutoff })
      .getRawMany<{ contactId: string }>();

    let total = 0;
    for (const { contactId } of stale) {
      const contact = await this.contactRepository.findOne({
        where: { id: contactId },
        select: ['id', 'phoneE164'],
      });
      // Already erased, by this job or by an admin acting on a request. Skipping keeps the sweep
      // idempotent and keeps the log count honest.
      if (!contact || contact.phoneE164.startsWith(ERASED_PHONE_PREFIX))
        continue;

      await this.contactRepository.update(
        { id: contactId },
        {
          phoneE164: `${ERASED_PHONE_PREFIX}${contactId}`,
          phoneLast4: '0000',
          locale: null,
        },
      );
      total += 1;
    }
    return total;
  }
}

/**
 * The placeholder written over an erased body.
 *
 * Shared with the manual per-contact erasure so the two paths cannot disagree — and so a row erased
 * either way is skipped by the next sweep rather than written again.
 */
export const ERASED = '[erased]';

/** Prefix marking an erased number. The row stays identifiable for audit; the number does not. */
export const ERASED_PHONE_PREFIX = 'erased:';
