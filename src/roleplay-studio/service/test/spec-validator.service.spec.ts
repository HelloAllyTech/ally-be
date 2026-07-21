import { SpecValidatorService } from '../spec-validator.service';
import { DataSource } from 'typeorm';
import {
  RoleplaySpecDocument,
  SPEC_SCHEMA_VERSION,
} from '../../type/roleplay-spec-document.type';

describe('SpecValidatorService', () => {
  let service: SpecValidatorService;
  let mockVoiceRepo: { find: jest.Mock };

  const buildValidSpec = (): RoleplaySpecDocument => ({
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    title: 'Grief disclosure roleplay',
    competencyId: 'comp-1',
    persona: {
      identityCore: 'Maya, 34, recently widowed teacher',
      scenarioContext: 'First counselling session after her loss',
      chunks: [
        { id: 'chunk-1', topics: ['family'], content: 'Two kids, 6 and 9.' },
      ],
    },
    stateMachine: {
      initialStateId: 'guarded',
      states: [
        {
          id: 'guarded',
          name: 'Guarded',
          transitions: [
            {
              id: 't1',
              toStateId: 'testing',
              whenBehaviorsAny: ['b-empathy'],
              minTurnsInState: 2,
            },
          ],
        },
        {
          id: 'testing',
          name: 'Testing the counsellor',
          transitions: [
            {
              id: 't2',
              toStateId: 'open',
              whenBehaviorsAll: ['b-empathy'],
              minCumulativeScore: 3,
            },
          ],
        },
        { id: 'open', name: 'Open', transitions: [] },
      ],
    },
    disclosureLedger: {
      secrets: [
        {
          id: 's1',
          topic: 'guilt',
          content: 'She feels guilty about the last argument.',
          minStateIds: ['open'],
          lockedDeflection: 'Changes the subject to her kids.',
          tier: 2,
        },
      ],
    },
    rubric: {
      behaviors: [
        {
          id: 'b-empathy',
          name: 'Reflects feeling',
          polarity: 'helpful',
          weight: 2,
          examples: ['That sounds incredibly heavy.'],
        },
      ],
    },
    engineeredEvents: [
      {
        id: 'e1',
        name: 'Phone buzzes',
        trigger: 'time',
        atSeconds: 300,
        direction: 'Glance at the phone, apologise, silence it.',
        once: true,
      },
    ],
    voice: { languageVoices: { '1': 'voice-1' } },
    language: { languageId: 1, languageCode: 'en-US' },
    openingStatement: 'I am not even sure why I booked this.',
    difficulty: 'MEDIUM',
    actorModel: { provider: 'anthropic', config: {} },
    directorModel: { provider: 'anthropic', config: {} },
    ui: { layout: 'anything the client wants' },
  });

  beforeEach(() => {
    mockVoiceRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 'voice-1', name: 'Ivy', languageId: 1, active: true },
        ]),
    };
    const dataSource = {
      getRepository: jest.fn(() => mockVoiceRepo),
    } as unknown as DataSource;
    service = new SpecValidatorService(dataSource);
  });

  it('accepts a fully valid spec (including DB checks)', async () => {
    const result = await service.validate(buildValidSpec());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object documents', () => {
    expect(service.validateStructure(null)[0].code).toBe('invalid_document');
    expect(
      service.validateStructure([] as unknown as RoleplaySpecDocument)[0].code,
    ).toBe('invalid_document');
  });

  it('rejects a wrong specSchemaVersion', () => {
    const spec = { ...buildValidSpec(), specSchemaVersion: '2.0' };
    const errors = service.validateStructure(spec);
    expect(errors.some((e) => e.code === 'unsupported_schema_version')).toBe(
      true,
    );
  });

  describe('state bounds', () => {
    it('rejects fewer than 3 states', () => {
      const spec = buildValidSpec();
      spec.stateMachine.states = spec.stateMachine.states.slice(0, 2);
      spec.stateMachine.states[0].transitions = [];
      spec.stateMachine.initialStateId = 'guarded';
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'state_count_out_of_bounds')).toBe(
        true,
      );
    });

    it('rejects more than 6 states', () => {
      const spec = buildValidSpec();
      for (let i = 0; i < 5; i++) {
        spec.stateMachine.states.push({
          id: `extra-${i}`,
          name: `Extra ${i}`,
          transitions: [],
        });
      }
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'state_count_out_of_bounds')).toBe(
        true,
      );
    });

    it('accepts exactly 6 states', () => {
      const spec = buildValidSpec();
      for (let i = 0; i < 3; i++) {
        spec.stateMachine.states.push({
          id: `extra-${i}`,
          name: `Extra ${i}`,
          transitions: [],
        });
      }
      expect(
        service
          .validateStructure(spec)
          .filter((e) => e.code === 'state_count_out_of_bounds'),
      ).toEqual([]);
    });
  });

  describe('initial state', () => {
    it('rejects an initialStateId that matches no state', () => {
      const spec = buildValidSpec();
      spec.stateMachine.initialStateId = 'nope';
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'invalid_initial_state')).toBe(true);
    });

    it('rejects duplicate state ids (initialStateId would match twice)', () => {
      const spec = buildValidSpec();
      spec.stateMachine.states[2] = {
        ...spec.stateMachine.states[2],
        id: 'guarded',
      };
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'duplicate_id')).toBe(true);
      expect(errors.some((e) => e.code === 'invalid_initial_state')).toBe(true);
    });
  });

  describe('dangling references', () => {
    it('flags a transition toStateId that does not exist', () => {
      const spec = buildValidSpec();
      spec.stateMachine.states[0].transitions![0].toStateId = 'ghost';
      const errors = service.validateStructure(spec);
      expect(
        errors.some(
          (e) =>
            e.code === 'dangling_reference' &&
            e.path === '/stateMachine/states/0/transitions/0/toStateId',
        ),
      ).toBe(true);
    });

    it('flags transition guard behaviors missing from the rubric', () => {
      const spec = buildValidSpec();
      spec.stateMachine.states[0].transitions![0].whenBehaviorsAny = [
        'ghost-b',
      ];
      const errors = service.validateStructure(spec);
      expect(
        errors.some(
          (e) =>
            e.code === 'dangling_reference' &&
            e.path.includes('whenBehaviorsAny'),
        ),
      ).toBe(true);
    });

    it('flags secret minStateIds pointing at unknown states', () => {
      const spec = buildValidSpec();
      spec.disclosureLedger.secrets[0].minStateIds = ['ghost-state'];
      const errors = service.validateStructure(spec);
      expect(
        errors.some(
          (e) =>
            e.code === 'dangling_reference' && e.path.includes('minStateIds'),
        ),
      ).toBe(true);
    });

    it('flags engineered-event behaviorIds missing from the rubric', () => {
      const spec = buildValidSpec();
      spec.engineeredEvents![0] = {
        ...spec.engineeredEvents![0],
        trigger: 'behavior',
        behaviorIds: ['ghost-b'],
      };
      const errors = service.validateStructure(spec);
      expect(
        errors.some(
          (e) =>
            e.code === 'dangling_reference' && e.path.includes('behaviorIds'),
        ),
      ).toBe(true);
    });

    it('flags duplicate secret ids', () => {
      const spec = buildValidSpec();
      spec.disclosureLedger.secrets.push({
        ...spec.disclosureLedger.secrets[0],
      });
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'duplicate_id')).toBe(true);
    });
  });

  describe('enums and shapes', () => {
    it('rejects an invalid rubric polarity', () => {
      const spec = buildValidSpec();
      (spec.rubric.behaviors[0] as any).polarity = 'neutral';
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'invalid_enum')).toBe(true);
    });

    it('rejects an invalid engineered-event trigger', () => {
      const spec = buildValidSpec();
      (spec.engineeredEvents![0] as any).trigger = 'weather';
      const errors = service.validateStructure(spec);
      expect(errors.some((e) => e.code === 'invalid_enum')).toBe(true);
    });

    it('treats ui as opaque apart from being an object', () => {
      const spec = buildValidSpec();
      spec.ui = { anything: { deeply: ['nested', 42] } };
      expect(service.validateStructure(spec)).toEqual([]);
      (spec as any).ui = 'not-an-object';
      expect(
        service.validateStructure(spec).some((e) => e.path === '/ui'),
      ).toBe(true);
    });
  });

  describe('catalog (DB) checks', () => {
    it('flags unknown, inactive and language-mismatched voices', async () => {
      mockVoiceRepo.find.mockResolvedValue([
        { id: 'voice-1', name: 'Ivy', languageId: 2, active: false },
      ]);
      const spec = buildValidSpec();
      spec.voice.languageVoices = { '1': 'voice-1', '3': 'voice-ghost' };
      const result = await service.validate(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'inactive_voice')).toBe(true);
      expect(result.errors.some((e) => e.code === 'unknown_voice')).toBe(true);
    });

    it('skips DB checks when checkDb is false', async () => {
      const result = await service.validate(buildValidSpec(), {
        checkDb: false,
      });
      expect(result.valid).toBe(true);
      expect(mockVoiceRepo.find).not.toHaveBeenCalled();
    });

    it('skips DB checks when the document is structurally broken', async () => {
      const spec = buildValidSpec();
      spec.stateMachine.initialStateId = 'ghost';
      const result = await service.validate(spec);
      expect(result.valid).toBe(false);
      expect(mockVoiceRepo.find).not.toHaveBeenCalled();
    });
  });
});
