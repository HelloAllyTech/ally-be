import { BuilderInterviewToolsService } from '../builder-interview-tools.service';
import { BuilderPrdService } from '../builder-prd.service';
import { SandboxStores } from '../../eval/sandbox/builder-eval-stores';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';

/**
 * The validated belt, end to end through the real PRD service on in-memory
 * stores: edits by id land in the stored document, a bad one comes back with
 * what is there instead, and with the switch off the belt is the old one.
 */
describe('BuilderInterviewToolsService — validated belt and edits by id', () => {
  const build = async (validatedTurns = true) => {
    const stores = new SandboxStores();
    const prdService = new BuilderPrdService(
      stores.docRepository as any,
      stores.dataSource as any,
    );
    const readiness = {
      settle: jest.fn().mockResolvedValue({
        score: 50,
        ready: false,
        sections: [],
        blockers: ['R2 has no acceptance criteria.'],
      }),
    };
    const service = new BuilderInterviewToolsService(
      prdService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { recordToolResult: jest.fn() } as any,
      readiness as any,
      {} as any,
      {} as any,
    );
    const empty = await prdService.getOrCreateDoc('session-1', 7, 'Rating');
    const { doc } = await prdService.applyPatch(
      empty,
      [
        {
          op: 'add',
          path: '/requirements',
          value: [
            {
              id: 'R1',
              title: 'Rating',
              description: 'Thumbs',
              acceptanceCriteria: ['a'],
            },
            {
              id: 'R2',
              title: 'Attribution',
              description: 'Variant',
              acceptanceCriteria: [],
            },
          ],
        },
      ],
      7,
      'agent' as any,
    );
    const context = {
      session: { id: 'session-1' },
      doc,
      userId: 7,
      validatedTurns,
    } as any;
    return { service, context, stores };
  };

  it('keeps the old belt exactly when the switch is off', async () => {
    const { service } = await build(false);
    const tools = service.getToolDefinitions();
    const names = tools.map((tool: any) => tool.name);
    expect(names).not.toContain('finish_turn');
    expect(names).not.toContain('upsert_requirement');
    const ask = tools.find((tool: any) => tool.name === 'ask_admin');
    expect(ask.input_schema.properties.message).toBeUndefined();
    expect(ask.input_schema.required).toEqual(['prompt', 'kind']);
  });

  it('adds the reply, finish_turn and the edit-by-id tools when it is on', async () => {
    const { service } = await build();
    const tools = service.getToolDefinitions({ validatedTurns: true });
    const names = tools.map((tool: any) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'finish_turn',
        'set_section',
        'upsert_requirement',
        'remove_requirement',
        'set_repo_plan',
        'remove_repo_plan',
        'upsert_assumption',
        'set_open_questions',
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
    const ask = tools.find((tool: any) => tool.name === 'ask_admin');
    expect(ask.input_schema.required).toEqual(['prompt', 'kind', 'message']);
    expect(ask.description).toMatch(/sent back to you undelivered/);
    const update = tools.find((tool: any) => tool.name === 'update_prd');
    expect(update.description).toMatch(/\/requirements\/R3\/title/);
  });

  it('removes one requirement and edits another by id, both landing', async () => {
    const { service, context, stores } = await build();

    const removed = await service.execute(
      'remove_requirement',
      { id: 'R1' },
      context,
    );
    const edited = await service.execute(
      'upsert_requirement',
      {
        id: 'R2',
        acceptanceCriteria: ['The variant is stored with the rating'],
      },
      context,
    );

    expect(removed.modelResult).toMatchObject({ ok: true });
    expect(edited.modelResult).toMatchObject({
      ok: true,
      stored: {
        id: 'R2',
        acceptanceCriteria: ['The variant is stored with the rating'],
      },
      blockers: ['R2 has no acceptance criteria.'],
    });
    expect(edited.events?.map((frame) => frame.event)).toEqual([
      'prd_draft',
      'readiness',
    ]);
    const stored = await stores.docRepository.findBySession('session-1');
    expect(stored?.draft.requirements.map((row: any) => row.id)).toEqual([
      'R2',
    ]);
    expect(context.doc.versionNumber).toBe(3);
  });

  it('hands a bad edit back with what is there, and writes nothing', async () => {
    const { service, context } = await build();

    const outcome = await service.execute(
      'remove_requirement',
      { id: 'R9' },
      context,
    );

    expect(outcome.modelResult).toMatchObject({
      ok: false,
      error: 'edit_failed',
      message: expect.stringMatching(
        /no requirement R9 to remove \(ids: R1, R2\)/,
      ),
    });
    expect(context.doc.versionNumber).toBe(1);
  });

  it('refuses an update_prd that adds a repo plan with no repo, before anything is written', async () => {
    const { service, context } = await build();

    const outcome = await service.execute(
      'update_prd',
      {
        ops: [
          {
            op: 'add',
            path: '/technicalPlan/repos/-',
            value: { changesMd: 'The rating' },
          },
        ],
      },
      context,
    );

    expect(outcome.modelResult).toMatchObject({
      ok: false,
      error: 'patch_rejected',
      message: expect.stringMatching(/needs a repo/),
    });
    expect(context.doc.versionNumber).toBe(1);
  });

  it('lets the same write through with the switch off, as it always did', async () => {
    const { service, context } = await build(false);

    const outcome = await service.execute(
      'update_prd',
      {
        ops: [
          {
            op: 'add',
            path: '/technicalPlan/repos/-',
            value: { changesMd: 'The rating' },
          },
        ],
      },
      context,
    );

    expect(outcome.modelResult).toMatchObject({ ok: true });
  });

  it('accepts an id where update_prd used to need an index', async () => {
    const { service, context } = await build();

    const outcome = await service.execute(
      'update_prd',
      {
        ops: [
          { op: 'remove', path: '/requirements/R1' },
          {
            op: 'replace',
            path: '/requirements/R2/title',
            value: 'Variant attribution',
          },
        ],
      },
      context,
    );

    expect(outcome.modelResult).toMatchObject({ ok: true });
    expect(context.doc.draft.requirements).toEqual([
      expect.objectContaining({ id: 'R2', title: 'Variant attribution' }),
    ]);
    // `createEmptyPrdDocument` is the shape every key starts from.
    expect(Object.keys(context.doc.draft)).toEqual(
      expect.arrayContaining(Object.keys(createEmptyPrdDocument())),
    );
  });
});
