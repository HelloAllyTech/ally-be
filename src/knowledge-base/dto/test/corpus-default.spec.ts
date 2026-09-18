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

/**
 * `includeArchived` on a query string.
 *
 * `@Type(() => Boolean)` was the obvious-looking choice and is wrong: a query parameter arrives
 * as a STRING, and `Boolean("false")` is `true`. So `?includeArchived=false` was read as true
 * and archived documents were ALWAYS returned — which made the WhatsApp Corpus tab's "Show
 * archived" checkbox inert in both positions from the day it shipped, and kept three archived
 * documents rendering in the character panel after they had been archived.
 */
describe('includeArchived on a query string', () => {
  const parse = async (value: unknown) => {
    const dto = plainToInstance(GetKbDocumentsQueryDto, {
      corpus: KbCorpus.CHARACTER_LIBRARY,
      includeArchived: value,
    });
    const errors = await validate(dto as object);
    return { includeArchived: dto.includeArchived, errors };
  };

  it('reads the string "false" as false, which Boolean() does not', async () => {
    const { includeArchived, errors } = await parse('false');
    expect(includeArchived).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('reads the string "true" as true', async () => {
    expect((await parse('true')).includeArchived).toBe(true);
  });

  it('is case-insensitive, since a hand-typed URL is a real caller', async () => {
    expect((await parse('TRUE')).includeArchived).toBe(true);
    expect((await parse('False')).includeArchived).toBe(false);
  });

  it('treats anything unrecognised as false — the safe direction for a widening flag', async () => {
    expect((await parse('yes')).includeArchived).toBe(false);
    expect((await parse('1')).includeArchived).toBe(false);
    expect((await parse('')).includeArchived).toBe(false);
  });

  it('still accepts a real boolean, for a JSON caller', async () => {
    expect((await parse(true)).includeArchived).toBe(true);
    expect((await parse(false)).includeArchived).toBe(false);
  });

  it('leaves it undefined when absent, so the repository default applies', async () => {
    const dto = plainToInstance(GetKbDocumentsQueryDto, {
      corpus: KbCorpus.CHARACTER_LIBRARY,
    });
    expect(dto.includeArchived).toBeUndefined();
    expect(await validate(dto as object)).toHaveLength(0);
  });
});
