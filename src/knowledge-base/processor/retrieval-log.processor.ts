import { Injectable } from '@nestjs/common';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';

import {
  RetrievalLogMessage,
  RetrievalLogPassage,
} from '../../learn/interface/learn-message.interface';
import {
  KB_LOGGED_CORPORA,
  KbRetrievalConsumer,
  KbRetrievalDisposition,
  KbRetrievalOutcome,
  KbRetrievalPass,
  KbLoggedCorpus,
} from '../enum/knowledge-base.enum';
import { KbRetrievalRepository } from '../repository/kb-retrieval.repository';

/** Caps one message can contribute, so a malformed payload cannot write thousands of rows. */
const MAX_PASSAGES_PER_MESSAGE = 60;

/**
 * Persists retrievals performed OUTSIDE this service (message_type `retrieval_log`).
 *
 * The WhatsApp Q&A bot retrieves inside ally-ai in a single call and never passes through
 * KnowledgeBaseService, so until this existed the platform's highest-volume RAG path was the
 * one nothing measured — and `whatsapp_qa`'s similarity floor was the number with the least
 * evidence behind it, while the character corpus had a judge and a precision curve.
 *
 * Best-effort and never rethrows, for the same reason the in-process writer swallows its own
 * failures: analytics are worth a table, not a health worker's answer. A retry-storm on this
 * queue would cost far more than a missing row.
 *
 * TRUST BOUNDARY. The payload crosses a service, so it is validated rather than believed: the
 * corpus and consumer must be known values, the query must be non-empty, numbers are coerced,
 * and `query_sensitive` defaults to TRUE when absent. That default is the important one — a
 * sender that forgets the flag must not cause a worker's question to be rendered in an admin
 * panel, so the safe reading of silence is "sensitive".
 */
@Injectable()
export class RetrievalLogProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    RetrievalLogProcessor.name,
  );

  constructor(private readonly retrievalRepository: KbRetrievalRepository) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.RETRIEVAL_LOG;
  }

  private static toEnum<T extends Record<string, string>>(
    dictionary: T,
    value: unknown,
  ): T[keyof T] | null {
    const values = Object.values(dictionary) as string[];
    return typeof value === 'string' && values.includes(value)
      ? (value as T[keyof T])
      : null;
  }

  private static toInt(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  private static toFloat(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private shapePassages(passages: RetrievalLogPassage[] | undefined) {
    return (passages ?? [])
      .slice(0, MAX_PASSAGES_PER_MESSAGE)
      .filter(
        (p) =>
          p &&
          typeof p.chunk_id === 'string' &&
          typeof p.document_id === 'string',
      )
      .map((p, index) => ({
        chunkId: p.chunk_id,
        documentId: p.document_id,
        rank: RetrievalLogProcessor.toInt(p.rank, index + 1),
        similarity: RetrievalLogProcessor.toFloat(p.similarity),
        // A sender that does not distinguish passes reports the only one it has.
        pass:
          RetrievalLogProcessor.toEnum(KbRetrievalPass, p.pass) ??
          KbRetrievalPass.REST,
        outcome:
          RetrievalLogProcessor.toEnum(KbRetrievalOutcome, p.outcome) ??
          KbRetrievalOutcome.RETURNED,
      }));
  }

  async process(message: RetrievalLogMessage): Promise<void> {
    const event = message?.data?.retrieval_log;
    // Wider than KbCorpus: an external surface (reference documents, roadmap duplicate
    // detection) reports here too, and its collection is not one this module ingests.
    const corpus =
      typeof event?.corpus === 'string' &&
      KB_LOGGED_CORPORA.includes(event.corpus)
        ? (event.corpus as KbLoggedCorpus)
        : null;
    const consumer = RetrievalLogProcessor.toEnum(
      KbRetrievalConsumer,
      event?.consumer,
    );
    const query = (event?.query ?? '').trim();

    if (!event || !corpus || !consumer || !query) {
      // Named rather than silent: a sender drifting from the contract should be visible before
      // someone reads a thinning series as a quality change.
      this.logger.warn(
        `[KB_RETRIEVAL] rejecting retrieval_log: corpus=${event?.corpus ?? 'n/a'} ` +
          `consumer=${event?.consumer ?? 'n/a'} query=${query ? 'present' : 'empty'}`,
      );
      return;
    }

    const passages = this.shapePassages(event.passages);

    try {
      await this.retrievalRepository.record(
        {
          corpus,
          consumer,
          query,
          // Absent means sensitive. See the class docstring.
          querySensitive: event.query_sensitive !== false,
          queryLanguage: event.query_language ?? null,
          characterTopics: [],
          tags: Array.isArray(event.tags) ? event.tags.map(String) : [],
          minSimilarity: RetrievalLogProcessor.toFloat(event.min_similarity),
          declineSimilarity:
            event.decline_similarity == null
              ? null
              : RetrievalLogProcessor.toFloat(event.decline_similarity),
          disposition: RetrievalLogProcessor.toEnum(
            KbRetrievalDisposition,
            event.disposition,
          ),
          requestedLimit: RetrievalLogProcessor.toInt(event.requested_limit),
          fetchLimit: RetrievalLogProcessor.toInt(
            event.fetch_limit,
            RetrievalLogProcessor.toInt(event.requested_limit),
          ),
          // Two-pass shaping belongs to this service's own retrieval; a single-call sender has
          // one pass, and reporting no preferred documents is the truth rather than a gap.
          preferredDocumentCount: 0,
          restDocumentCount: 0,
          firstPassHits: passages.length,
          // NULL, not 0: no top-up ran, which must stay distinguishable from one that ran and
          // found nothing.
          secondPassHits: null,
          returnedCount: RetrievalLogProcessor.toInt(event.returned_count),
          latencyMs: RetrievalLogProcessor.toInt(event.latency_ms),
          sessionId: event.session_id ?? null,
          createdBy: null,
        },
        passages,
      );
    } catch (error) {
      this.logger.warn(
        `[KB_RETRIEVAL] could not persist a reported retrieval: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
