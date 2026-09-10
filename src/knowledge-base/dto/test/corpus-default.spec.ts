import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateKbDocumentDto,
  GetKbDocumentsQueryDto,
  GetKbStatsQueryDto,
  KbSearchDto,
} from '../knowledge-base.dto';
import { KbCorpus, KbDocumentSourceType } from '../../enum/knowledge-base.enum';

/**
 * The shipped admin dashboard sends none of these a `corpus`, and ally-be deploys before
 * ally-web. A required field here would 400 the live WhatsApp Corpus tab — list, stats,
 * search and upload all at once — for the length of the deploy window.
 *
 * So these assert the compatibility contract directly: an omitted corpus resolves to the
 * WhatsApp corpus rather than failing validation, and an explicit one is honoured. Safe
 * only because each corpus has its own Weaviate collection; with a shared collection the
 * same default would be a silent cross-corpus read.
 */

const check = async <T extends object>(cls: new () => T, payload: object) => {
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto as object, { whitelist: false });
  return { dto, errors };
};

describe('corpus defaults on the HTTP edge', () => {
  it('lets the shipped dashboard list documents without sending a corpus', async () => {
    const { dto, errors } = await check(GetKbDocumentsQueryDto, {
      limit: 25,
      offset: 0,
      includeArchived: false,
    });
    expect(errors).toHaveLength(0);
    expect(dto.corpus).toBe(KbCorpus.WHATSAPP_QA);
  });

  it('lets the shipped dashboard read stats without sending a corpus', async () => {
    const { dto, errors } = await check(GetKbStatsQueryDto, {});
    expect(errors).toHaveLength(0);
    expect(dto.corpus).toBe(KbCorpus.WHATSAPP_QA);
  });

  it('lets the shipped dashboard search without sending a corpus', async () => {
    const { dto, errors } = await check(KbSearchDto, { query: 'vpn reset' });
    expect(errors).toHaveLength(0);
    expect(dto.corpus).toBe(KbCorpus.WHATSAPP_QA);
  });

  it('lets the shipped dashboard create a document without sending a corpus', async () => {
    const { dto, errors } = await check(CreateKbDocumentDto, {
      title: 'Managing risk',
      sourceType: KbDocumentSourceType.PASTE,
      text: 'Ask directly about intent.',
    });
    expect(errors).toHaveLength(0);
    expect(dto.corpus).toBe(KbCorpus.WHATSAPP_QA);
  });

  it('honours an explicit corpus everywhere', async () => {
    for (const cls of [
      GetKbDocumentsQueryDto,
      GetKbStatsQueryDto,
      KbSearchDto,
    ] as const) {
      const { dto } = await check(cls, {
        corpus: KbCorpus.CHARACTER_LIBRARY,
        query: 'q',
      });
      expect(dto.corpus).toBe(KbCorpus.CHARACTER_LIBRARY);
    }
  });

  it('still rejects a corpus that does not exist', async () => {
    // A typo must not silently fall back to the WhatsApp corpus.
    const { errors } = await check(GetKbDocumentsQueryDto, {
      corpus: 'character-library',
    });
    expect(errors.map((e) => e.property)).toContain('corpus');
  });
});
