import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GlossaryEntryStatus } from '../../entity/language-glossary-section.entity';
import {
  GlossaryLexemeMiningService,
  parsePairingOutput,
  requireSayEvidence,
} from '../glossary-lexeme-mining.service';

/**
 * Five sessions in five scenarios. The agent says the literary அதனால் and
 * நன்றாக and the formal நீங்கள்; counsellors say அதனால, நல்லா and நீங்க.
 */
const SESSIONS = Array.from({ length: 5 }, (_, i) => ({
  sid: `00000000-0000-0000-0000-00000000000${i}`,
  scenarioId: i + 1,
}));
const MESSAGES = SESSIONS.flatMap(({ sid }) => [
  { sid, senderId: 12, content: 'நீங்க நல்லா இருக்கீங்களா அதனால கேக்குறேன்' },
  {
    sid,
    senderId: -1,
    content:
      'அதனால் நான் நன்றாக இல்லை. நீங்கள் கேட்டதுக்கு நன்றி அதனால் சொல்றேன்',
  },
  { sid, senderId: 0, content: 'system row, neither side' },
]);

const section = (over: any = {}) => ({
  id: 'sec-core',
  sectionCode: 'core_style',
  profileId: null,
  content: '- yes: say `ஆமா` (avoid: `ஆமாம்`)',
  entries: [],
  version: 4,
  ...over,
});

describe('GlossaryLexemeMiningService', () => {
  let service: GlossaryLexemeMiningService;
  let dataSource: any;
  let glossaryRepository: any;
  let batchRepository: any;
  let getCompletion: jest.Mock;
  let core: any;
  let redis: any;
  let store: Map<string, string>;

  const verdicts = (list: unknown[]) =>
    getCompletion.mockResolvedValue(JSON.stringify(list));

  beforeEach(() => {
    core = section();
    // In-memory stand-in for RedisService: get/set plus the NX lock.
    store = new Map();
    redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      acquireLock: jest.fn(async (k: string) => {
        if (store.has(k)) return false;
        store.set(k, '1');
        return true;
      }),
      releaseLock: jest.fn(async (k: string) => void store.delete(k)),
    };
    dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce(SESSIONS)
        .mockResolvedValueOnce(MESSAGES),
    };
    glossaryRepository = {
      findAllForLanguage: jest.fn().mockResolvedValue([core]),
      save: jest.fn(async (v: any) => v),
      create: jest.fn((v: any) => ({ id: 'sec-new', ...v })),
    };
    batchRepository = {
      create: jest.fn((v: any) => ({ id: 'batch-1', ...v })),
      save: jest.fn(async (v: any) => v),
    };
    getCompletion = jest.fn();
    const glossaryService: any = {
      assertLanguageExists: jest
        .fn()
        .mockResolvedValue({ id: 6, value: 'ta-IN', label: 'Tamil (India)' }),
      summarizeGlossary: jest.fn().mockReturnValue('### core_style'),
      resolvePromptByCode: jest.fn().mockResolvedValue({
        systemPrompt:
          'Pair for {{languageName}}.\n{{candidates}}\nSAY: {{learnerLexicon}}',
        engine: { provider: 'gemini', model: 'm', temperature: 0.2 },
      }),
    };
    service = new GlossaryLexemeMiningService(
      dataSource,
      glossaryService,
      glossaryRepository,
      batchRepository,
      { getProvider: jest.fn().mockReturnValue({ getCompletion }) } as any,
      redis,
    );
  });

  it('pairs agent-over-used words and writes nothing in a dry run', async () => {
    // The model's view is built from the candidate list, so read the indexes
    // back from the prompt rather than assuming an order.
    getCompletion.mockImplementation(async (messages: any[]) => {
      const prompt = messages[0].content as string;
      const idx = (t: string) =>
        Number(
          prompt
            .split('\n')
            .find((l) => new RegExp(`^\\d+\\. ${t} `).test(l))!
            .split('.')[0],
        );
      return JSON.stringify([
        {
          index: idx('அதனால்'),
          verdict: 'pair',
          say: 'அதனால',
          meaning: 'so',
          wordClass: 'conjunction',
          reason: 'literary ending',
        },
        {
          index: idx('நீங்கள்'),
          verdict: 'pair',
          say: 'நீங்க',
          meaning: 'you (formal)',
          wordClass: 'lexeme',
          reason: 'literary',
        },
      ]);
    });

    const out = await service.mineLexemes(6);

    expect(out.dryRun).toBe(true);
    expect(out.stats.sessions).toBe(5);
    const so = out.proposals.find((p) => p.token === 'அதனால்')!;
    expect(so.markdown).toBe('- so: say `அதனால` (avoid: `அதனால்`)');
    expect(so.swapSafe).toBe(true);
    expect(so.evidence?.verdict).toBe('confirmed');
    // An address form is never mechanically swappable, whatever the model
    // calls its word class.
    expect(out.proposals.find((p) => p.token === 'நீங்கள்')!.swapSafe).toBe(
      false,
    );
    expect(out.undecided.length).toBe(out.candidates.length - 2);
    // core_style is always-on (capped); with no on-demand vocabulary section
    // the pairs would go to a new everyday_words section.
    expect(out.targetSection).toBe('everyday_words');
    expect(glossaryRepository.save).not.toHaveBeenCalled();
    expect(batchRepository.save).not.toHaveBeenCalled();
  });

  it('feeds the counsellors’ own vocabulary to the pairing prompt', async () => {
    verdicts([]);
    await service.mineLexemes(6);
    const prompt = getCompletion.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('SAY: ');
    expect(prompt).toMatch(/நல்லா \(5\)/);
    expect(prompt).toContain('AI: "');
  });

  it('skips words the glossary already mentions', async () => {
    core.content = '- well: say `நல்லா` (avoid: `நன்றாக`)';
    verdicts([]);
    const out = await service.mineLexemes(6);
    expect(out.candidates.map((c) => c.token)).not.toContain('நன்றாக');
    expect(out.stats.droppedAlreadyInGlossary).toBeGreaterThan(0);
  });

  it('queues surviving pairs as PROPOSED entries in a batch when not a dry run', async () => {
    getCompletion.mockImplementation(async (messages: any[]) => {
      const line = (messages[0].content as string)
        .split('\n')
        .find((l) => /^\d+\. அதனால் /.test(l))!;
      return JSON.stringify([
        {
          index: Number(line.split('.')[0]),
          verdict: 'pair',
          say: 'அதனால',
          meaning: 'so',
          wordClass: 'conjunction',
        },
      ]);
    });

    const out = await service.mineLexemes(6, { dryRun: false });

    expect(out.stats.written).toBe(1);
    expect(out.batchId).toBe('batch-1');
    const saved = glossaryRepository.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      sectionCode: 'everyday_words',
      injectionMode: 'retrieved',
      status: 'published',
      tierPinned: true,
      version: 1,
    });
    expect(core.entries).toEqual([]);
    expect(saved.entries[0]).toMatchObject({
      markdown: '- so: say `அதனால` (avoid: `அதனால்`)',
      status: GlossaryEntryStatus.PROPOSED,
      provenance: {
        source: 'lexeme_mining',
        batchId: 'batch-1',
        lexeme: { wordClass: 'conjunction', swapSafe: true },
      },
    });
    const batch = batchRepository.save.mock.calls.at(-1)[0];
    expect(batch.trigger).toBe('lexeme_mining');
    expect(batch.autoAccepted).toBe(false);
    expect(batch.entries).toHaveLength(1);
  });

  it('queues into an on-demand general_vocabulary section when there is one', async () => {
    const vocab = section({
      id: 'sec-vocab',
      sectionCode: 'general_vocabulary',
      injectionMode: 'retrieved',
      status: 'published',
      content: '',
      version: 7,
    });
    glossaryRepository.findAllForLanguage.mockResolvedValue([core, vocab]);
    getCompletion.mockImplementation(async (messages: any[]) => {
      const line = (messages[0].content as string)
        .split('\n')
        .find((l) => /^\d+\. அதனால் /.test(l))!;
      return JSON.stringify([
        {
          index: Number(line.split('.')[0]),
          verdict: 'pair',
          say: 'அதனால',
          meaning: 'so',
          wordClass: 'conjunction',
        },
      ]);
    });

    const out = await service.mineLexemes(6, { dryRun: false });

    expect(out.targetSection).toBe('general_vocabulary');
    const saved = glossaryRepository.save.mock.calls[0][0];
    expect(saved.id).toBe('sec-vocab');
    expect(saved.version).toBe(8);
    expect(glossaryRepository.create).not.toHaveBeenCalled();
  });

  it('never picks an always-on general_vocabulary', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      core,
      section({
        sectionCode: 'general_vocabulary',
        injectionMode: 'always',
        status: 'published',
      }),
    ]);
    verdicts([]);
    const out = await service.mineLexemes(6);
    expect(out.targetSection).toBe('everyday_words');
  });

  it('does not write a pair the population contradicts', async () => {
    // Counsellors say the "bookish" word far more than the replacement.
    getCompletion.mockImplementation(async (messages: any[]) => {
      const line = (messages[0].content as string)
        .split('\n')
        .find((l) => /^\d+\. நன்றாக /.test(l))!;
      return JSON.stringify([
        {
          index: Number(line.split('.')[0]),
          verdict: 'pair',
          say: 'நல்லாவே',
          meaning: 'well',
          wordClass: 'lexeme',
        },
      ]);
    });
    const contradicting = SESSIONS.flatMap(({ sid }) => [
      { sid, senderId: 12, content: 'நன்றாக நன்றாக சொல்லுங்க' },
      { sid, senderId: -1, content: 'நன்றாக நன்றாக நன்றாக நன்றாக இருக்கு' },
    ]);
    dataSource.query = jest
      .fn()
      .mockResolvedValueOnce(SESSIONS)
      .mockResolvedValueOnce(contradicting);

    const out = await service.mineLexemes(6, { dryRun: false });

    const well = out.proposals.find((p) => p.token === 'நன்றாக');
    expect(well?.skipped).toBe('contradicted');
    expect(out.stats.written).toBe(0);
    expect(glossaryRepository.save).not.toHaveBeenCalled();
  });

  it('pairs in parallel chunks and maps chunk-local indexes back', async () => {
    // 15 agent-only words across 5 scenarios → two pairing calls (10 + 5).
    const words = Array.from(
      { length: 25 },
      (_, i) => `சொல்${'அ'.repeat(i + 1)}`,
    );
    const many = SESSIONS.flatMap(({ sid }) => [
      { sid, senderId: 12, content: 'சரி சொல்லுங்க' },
      { sid, senderId: -1, content: words.join(' ') },
    ]);
    dataSource.query = jest
      .fn()
      .mockResolvedValueOnce(SESSIONS)
      .mockResolvedValueOnce(many);
    getCompletion.mockImplementation(async (messages: any[]) => {
      const first = (messages[0].content as string)
        .split('\n')
        .find((l) => /^1\. /.test(l))!;
      const token = first.split(' ')[1];
      return JSON.stringify([
        { index: 1, verdict: 'keep', reason: `first of chunk: ${token}` },
      ]);
    });

    const out = await service.mineLexemes(6, { topK: 15 });

    expect(getCompletion).toHaveBeenCalledTimes(2);
    expect(out.kept.map((k) => k.token)).toEqual([
      out.candidates[0].token,
      out.candidates[10].token,
    ]);
    expect(out.kept[1].reason).toContain(out.candidates[10].token);
  });

  it('keeps only the first of several offered forms', async () => {
    getCompletion.mockImplementation(async (messages: any[]) => {
      const line = (messages[0].content as string)
        .split('\n')
        .find((l) => /^\d+\. அதனால் /.test(l))!;
      return JSON.stringify([
        {
          index: Number(line.split('.')[0]),
          verdict: 'pair',
          say: 'அதனால, அதான்…',
          meaning: 'so',
          wordClass: 'conjunction',
        },
      ]);
    });
    const out = await service.mineLexemes(6);
    expect(out.proposals[0].say).toBe('அதனால');
    expect(out.proposals[0].markdown).toBe(
      '- so: say `அதனால` (avoid: `அதனால்`)',
    );
  });

  it('never calls the model when nothing was mined', async () => {
    dataSource.query = jest.fn().mockResolvedValueOnce([]);
    const out = await service.mineLexemes(6);
    expect(out.candidates).toEqual([]);
    expect(getCompletion).not.toHaveBeenCalled();
  });
});

describe('GlossaryLexemeMiningService jobs', () => {
  let service: GlossaryLexemeMiningService;
  let store: Map<string, string>;
  let mine: jest.SpyInstance;
  let assertLanguageExists: jest.Mock;

  /** Let the fire-and-forget run settle. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };

  beforeEach(() => {
    store = new Map();
    const redis: any = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      acquireLock: jest.fn(async (k: string) => {
        if (store.has(k)) return false;
        store.set(k, '1');
        return true;
      }),
      releaseLock: jest.fn(async (k: string) => void store.delete(k)),
    };
    assertLanguageExists = jest.fn().mockResolvedValue({ id: 6 });
    service = new GlossaryLexemeMiningService(
      {} as any,
      { assertLanguageExists } as any,
      {} as any,
      {} as any,
      {} as any,
      redis,
    );
    mine = jest.spyOn(service, 'mineLexemes');
  });

  it('returns a running job at once and records the result when done', async () => {
    let finish!: (v: any) => void;
    mine.mockReturnValue(new Promise((r) => (finish = r)));

    const job = await service.startJob(6, {});

    expect(job.status).toBe('running');
    expect(job.options.dryRun).toBe(true);
    expect((await service.getJob(6, job.jobId)).status).toBe('running');

    finish({ stats: { written: 0 } });
    await settle();
    const done = await service.getJob(6, job.jobId);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ stats: { written: 0 } });
    expect(done.finishedAt).toBeDefined();
  });

  it('records a failure with its message and frees the language', async () => {
    mine.mockRejectedValue(new Error('pairing exploded'));
    const job = await service.startJob(6, {});
    await settle();

    const failed = await service.getJob(6, job.jobId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('pairing exploded');
    mine.mockResolvedValue({});
    await expect(service.startJob(6, {})).resolves.toBeDefined();
  });

  it('refuses a second concurrent run for the same language', async () => {
    mine.mockReturnValue(new Promise(() => undefined));
    await service.startJob(6, {});
    await expect(service.startJob(6, {})).rejects.toThrow(ConflictException);
  });

  it('checks the language before creating a job', async () => {
    assertLanguageExists.mockRejectedValue(new NotFoundException('nope'));
    await expect(service.startJob(99, {})).rejects.toThrow(NotFoundException);
    expect(store.size).toBe(0);
  });

  it('reports a run lost mid-flight as failed', async () => {
    mine.mockReturnValue(new Promise(() => undefined));
    const job = await service.startJob(6, {});
    const key = [...store.keys()].find((k) => k.includes(job.jobId))!;
    store.set(
      key,
      JSON.stringify({
        ...job,
        startedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      }),
    );
    const lost = await service.getJob(6, job.jobId);
    expect(lost.status).toBe('failed');
    expect(lost.error).toMatch(/did not finish/);
  });

  it('404s an unknown job and one polled under another language', async () => {
    mine.mockResolvedValue({});
    const job = await service.startJob(6, {});
    await expect(service.getJob(6, 'nope')).rejects.toThrow(NotFoundException);
    await expect(service.getJob(2, job.jobId)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('parsePairingOutput', () => {
  it('tolerates a fence and drops malformed verdicts', () => {
    const out = parsePairingOutput(
      '```json\n[{"index":1,"verdict":"pair","say":"x"},{"index":"2","verdict":"keep"},{"index":3,"verdict":"maybe"}]\n```',
    );
    expect(out).toEqual([{ index: 1, verdict: 'pair', say: 'x' }]);
  });

  it('recovers an array wrapped in prose', () => {
    expect(
      parsePairingOutput(
        'Here are my decisions:\n[{"index":1,"verdict":"keep"}]\nHope this helps.',
      ),
    ).toEqual([{ index: 1, verdict: 'keep' }]);
  });

  it('throws on unparseable output instead of reading it as "keep all"', () => {
    expect(() => parsePairingOutput('not json')).toThrow(BadRequestException);
    expect(() => parsePairingOutput('{"a":1}')).toThrow(BadRequestException);
  });
});

describe('requireSayEvidence', () => {
  const base = {
    say: 'மன அழுத்தம்',
    avoid: 'டென்ஷன்',
    avoidAgentCount: 9,
    avoidLearnerCount: 0,
  };

  it('downgrades a substring-scorer confirmation with no counsellor use', () => {
    expect(
      requireSayEvidence({ ...base, sayLearnerCount: 0, verdict: 'confirmed' })
        ?.verdict,
    ).toBe('unverified');
  });

  it('leaves real confirmations and contradictions alone', () => {
    expect(
      requireSayEvidence({ ...base, sayLearnerCount: 3, verdict: 'confirmed' })
        ?.verdict,
    ).toBe('confirmed');
    expect(
      requireSayEvidence({
        ...base,
        sayLearnerCount: 0,
        verdict: 'contradicted',
      })?.verdict,
    ).toBe('contradicted');
    expect(requireSayEvidence(null)).toBeNull();
  });
});
