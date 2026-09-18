import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { KnowledgeBaseService } from 'src/knowledge-base/service/knowledge-base.service';
import { CharacterInterviewToolsService } from '../character-interview-tools.service';
import { CharacterInterviewSessionRepository } from '../../repository/character-interview-session.repository';

jest.mock('src/logger/logger.service');

/**
 * `search_corpus` is the interview agent's only way to know something the admin did not tell
 * it, so its two failure modes are both about honesty rather than crashes.
 *
 * A retrieval that found nothing must arrive as a RESULT, not an error: every other tool uses
 * ok:false to mean "repair and retry", and the model obliges, so an honest "the corpus does
 * not cover this" reported as failure becomes a rephrase loop. And a retrieval that could not
 * RUN must be distinguishable from one that found nothing, or the agent tells an admin the
 * library lacks material it actually holds.
 */

const passage = (over: Record<string, any> = {}) => ({
  chunk_id: 'c1',
  document_id: 'd1',
  document_title: 'Living With Early-Stage Dementia',
  chunk_index: 0,
  text: 'Word-finding difficulty arrives earlier than most families expect.',
  char_start: 0,
  char_end: 100,
  page_from: 0,
  page_to: 0,
  section_path: 'How speech changes',
  source_url: '',
  language: 'en',
  token_count: 20,
  similarity: 0.61,
  ...over,
});

describe('search_corpus', () => {
  let service: CharacterInterviewToolsService;
  let knowledgeBaseService: { search: jest.Mock };
  const sessionRepository = { update: jest.fn(), findOne: jest.fn() };

  const run = (input: Record<string, any>, metadata?: Record<string, any>) =>
    (service as any).executeSearchCorpus(input, {
      session: { id: 'sess-1', metadata },
      userId: 7,
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    sessionRepository.update.mockResolvedValue({ affected: 1 });
    (LoggerService.getInstance as jest.Mock) = jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });
    knowledgeBaseService = { search: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterInterviewToolsService,
        {
          provide: CharacterInterviewSessionRepository,
          useValue: sessionRepository,
        },
        { provide: DataSource, useValue: { getRepository: jest.fn() } },
        { provide: KnowledgeBaseService, useValue: knowledgeBaseService },
      ],
    }).compile();
    service = module.get(CharacterInterviewToolsService);
  });

  it('searches the character corpus, attributed to the interview agent and its session', async () => {
    knowledgeBaseService.search.mockResolvedValue({ passages: [passage()] });

    await run({
      query: 'how does dementia change speech?',
      topics: ['speech_and_language'],
    });

    const [dto, context] = knowledgeBaseService.search.mock.calls[0];
    expect(dto).toMatchObject({
      corpus: 'character_library',
      query: 'how does dementia change speech?',
      characterTopics: ['speech_and_language'],
    });
    // Attribution matters: the floor gets calibrated against agent traffic, and an
    // unattributed retrieval would be filed as an operator's threshold probing.
    expect(context).toEqual({
      consumer: 'interview_agent',
      sessionId: 'sess-1',
      userId: 7,
    });
  });

  it('returns the passage text with what the model needs to use it', async () => {
    knowledgeBaseService.search.mockResolvedValue({ passages: [passage()] });

    const outcome = await run({ query: 'q' });

    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.passages[0]).toMatchObject({
      chunkId: 'c1',
      document: 'Living With Early-Stage Dementia',
      section: 'How speech changes',
      similarity: 0.61,
      text: 'Word-finding difficulty arrives earlier than most families expect.',
    });
  });

  it('does NOT end the turn — the agent searches, then keeps going', async () => {
    knowledgeBaseService.search.mockResolvedValue({ passages: [passage()] });
    const outcome = await run({ query: 'q' });
    expect(outcome.endTurn).toBeUndefined();
  });

  it('reports an empty corpus as a successful result, not a failure to retry', async () => {
    knowledgeBaseService.search.mockResolvedValue({ passages: [] });

    const outcome = await run({ query: 'nothing covers this' });

    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.passages).toEqual([]);
    // And it must say so, or the model has to guess what an empty list means.
    expect(outcome.modelResult.note).toMatch(/real answer, not a/i);
    expect(outcome.modelResult.note).toMatch(/do not imply/i);
  });

  it('distinguishes "retrieval is down" from "the corpus has nothing"', async () => {
    // Conflating these makes the agent tell an admin the library lacks material it holds.
    knowledgeBaseService.search.mockRejectedValue(
      new Error('weaviate is down'),
    );

    const outcome = await run({ query: 'q' });

    expect(outcome.modelResult.ok).toBe(false);
    expect(outcome.modelResult.error).toMatch(/NOT evidence the corpus lacks/i);
    expect(outcome.modelResult.error).toMatch(/do not.*tell the admin/i);
  });

  it('sends a passage once and references it thereafter', async () => {
    // The loop resends the whole transcript every turn, so a repeated 800-token passage is
    // paid for on every remaining turn, twice over.
    knowledgeBaseService.search.mockResolvedValue({ passages: [passage()] });

    const first = await run({ query: 'q1' });
    expect(first.modelResult.passages[0].text).toBeTruthy();
    expect(sessionRepository.update).toHaveBeenCalledWith(
      { id: 'sess-1' },
      { metadata: { servedChunkIds: ['c1'] } },
    );

    const second = await run({ query: 'q2' }, { servedChunkIds: ['c1'] });
    expect(second.modelResult.passages[0].text).toBeNull();
    expect(second.modelResult.passages[0].note).toMatch(/already provided/i);
    // Still told which passage matched — that is the part carrying information.
    expect(second.modelResult.passages[0].chunkId).toBe('c1');
    expect(second.modelResult.passages[0].similarity).toBe(0.61);
  });

  it('records only the passages that were newly sent', async () => {
    knowledgeBaseService.search.mockResolvedValue({
      passages: [passage({ chunk_id: 'old' }), passage({ chunk_id: 'new' })],
    });

    await run({ query: 'q' }, { servedChunkIds: ['old'] });

    expect(sessionRepository.update).toHaveBeenCalledWith(
      { id: 'sess-1' },
      { metadata: { servedChunkIds: ['old', 'new'] } },
    );
  });

  it('does not write when every passage was already served', async () => {
    knowledgeBaseService.search.mockResolvedValue({
      passages: [passage({ chunk_id: 'old' })],
    });

    await run({ query: 'q' }, { servedChunkIds: ['old'] });

    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('still returns passages when the served-set write fails', async () => {
    // Losing the set costs tokens, never correctness.
    knowledgeBaseService.search.mockResolvedValue({ passages: [passage()] });
    sessionRepository.update.mockRejectedValue(new Error('row is locked'));

    const outcome = await run({ query: 'q' });

    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.passages[0].text).toBeTruthy();
  });

  it('drops topics that are not real, rather than passing them on', async () => {
    knowledgeBaseService.search.mockResolvedValue({ passages: [] });

    await run({ query: 'q', topics: ['speech_and_language', 'astrology', ''] });

    expect(
      knowledgeBaseService.search.mock.calls[0][0].characterTopics,
    ).toEqual(['speech_and_language']);
  });

  it('rejects an empty query without calling retrieval', async () => {
    const outcome = await run({ query: '   ' });
    expect(outcome.modelResult.ok).toBe(false);
    expect(knowledgeBaseService.search).not.toHaveBeenCalled();
  });
});
