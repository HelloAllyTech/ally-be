import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { AnnotationSwatch } from 'src/track/type/annotation.type';
import { TrackItemType } from 'src/track/type/track.type';
import { AnnotationSpecialist } from '../annotation.specialist';
import { JournalSpecialist } from '../journal.specialist';
import { SpecialistValidationError } from '../specialist.types';
import {
  collectIds,
  expectAllUuids,
  fakeLlm,
  item,
  makeBlueprint,
  makeContext,
} from './specialist-test.fixtures';

describe('JournalSpecialist', () => {
  it('re-mints ids, defaults required, clamps to three prompts and validates', async () => {
    const llm = fakeLlm([
      {
        prompts: [
          {
            id: 'p1',
            prompt: 'When Asha went quiet, what did you do?',
            placeholder: 'The moment I noticed…',
          },
          {
            id: 'p1',
            prompt: 'Why did you respond that way?',
            required: false,
          },
          'What will you do differently next time?',
          { id: 'p4', prompt: 'A fourth prompt that should be dropped' },
          { id: 'p5', prompt: '   ' },
        ],
      },
    ]);
    const output = await new JournalSpecialist(llm.service).generate(
      makeContext('jr-1'),
    );
    const content = output.content as any;

    expect(() =>
      validateTrackItemContent({
        type: TrackItemType.JOURNAL,
        content,
        title: 'J',
      }),
    ).not.toThrow();
    expectAllUuids(collectIds(content));
    expect(content.prompts.map((p: any) => p.required)).toEqual([
      true,
      false,
      true,
    ]);
    expect(content.prompts[0].placeholder).toBe('The moment I noticed…');
    expect(output.summary).toBe('3 prompts');
  });

  it('hands the prompt the practice block it follows', async () => {
    const llm = fakeLlm(
      [{ prompts: [{ prompt: 'One?' }] }],
      'Follows:\n{{preceding_practice}}\nCount {{prompt_count}}',
    );
    const blueprint = makeBlueprint();
    // A game between the roleplay and the journal is skipped over.
    blueprint.sections[0].items.splice(
      3,
      0,
      item({
        id: 'gm-1',
        type: 'GAME',
        title: 'Breather',
        spec: { gameKey: 'SNAKE' },
      }),
    );
    const output = await new JournalSpecialist(llm.service).generate(
      makeContext('jr-1', {}, blueprint),
    );
    const prompt = llm.promptOf(0);
    expect(prompt).toContain(
      '[Annotated transcript] "A first shift, annotated"',
    );
    expect(prompt).toContain('[Roleplay] "Asha goes quiet"');
    expect(prompt).toContain('Client: Asha, 19, exam stress');
    expect(prompt).not.toContain('Breather');
    expect(prompt).toContain('Count 3');
    expect(output.summary).toBe('1 prompt');
  });

  it('fails with a repairable error when there are no prompts', async () => {
    const llm = fakeLlm([{ prompts: [] }]);
    await expect(
      new JournalSpecialist(llm.service).generate(makeContext('jr-1')),
    ).rejects.toBeInstanceOf(SpecialistValidationError);
  });
});

const TRANSCRIPT = {
  intro:
    'Asha texts after a hard week. Where does the listener fix before hearing?',
  units: [
    { id: 'u1', speaker: 'Texter', text: 'idk why im even texting' },
    {
      id: 'u2',
      speaker: 'Listener',
      text: 'It sounds like this week has been heavy.',
    },
    { id: 'u3', text: 'Listener: Have you tried making a study timetable?' },
    { id: 'u3', speaker: 'Texter', text: 'yeah. whatever' },
    { id: 'u5', speaker: 'Listener', text: '' },
  ],
  labels: [
    // Paraphrase of a brief behaviour → snapped to the brief's wording.
    {
      id: 'l1',
      text: 'reflects feelings!',
      polarity: 'helpful',
      description: 'Names the feeling.',
    },
    {
      id: 'l2',
      text: 'Gives advice too early',
      description: 'Jumps to fixing.',
    },
    { id: 'l3', text: 'Uses silence well', polarity: 'helpful' },
    { id: 'l4', text: 'Reflects feelings' },
  ],
  targets: [
    {
      unitId: 'u2',
      labelId: 'l1',
      note: 'Names the weight before anything else.',
    },
    { unitId: 'u3', labelId: 'l2', note: 'A fix before she feels heard.' },
    { unitId: 'u2', labelId: 'l1' },
    { unitId: 'u9', labelId: 'l1' },
    { unitId: 'u2', labelId: 'Uses silence well' },
  ],
};

describe('AnnotationSpecialist', () => {
  it('builds a valid TRANSCRIPT exercise with brief-worded labels and fresh ids', async () => {
    const llm = fakeLlm([TRANSCRIPT]);
    const output = await new AnnotationSpecialist(llm.service).generate(
      makeContext('ann-1'),
    );
    const content = output.content as any;

    expect(() =>
      validateTrackItemContent({
        type: TrackItemType.ANNOTATED_ARTIFACT,
        content,
        title: 'A',
      }),
    ).not.toThrow();
    expectAllUuids(collectIds(content));
    expect(content.kind).toBe('TRANSCRIPT');
    expect(content.settings).toEqual({
      passScore: 70,
      maxAttempts: null,
      falsePositivePenalty: 1,
      revealKey: 'after_pass_or_last_attempt',
    });

    // The empty line is dropped; the "Listener: …" prefix becomes the speaker.
    expect(content.units).toHaveLength(4);
    expect(content.units[2]).toEqual({
      id: expect.any(String),
      speaker: 'Listener',
      text: 'Have you tried making a study timetable?',
    });

    // Snapped to the brief, deduplicated, polarity → swatch.
    expect(
      content.labels.map((label: any) => [label.text, label.color]),
    ).toEqual([
      ['Reflects feelings', AnnotationSwatch.GREEN],
      ['Gives advice too early', AnnotationSwatch.ROSE],
      ['Uses silence well', AnnotationSwatch.TEAL],
    ]);
    expect(content.labels[0].polarity).toBeUndefined();

    // Duplicates and dangling references dropped; label-by-text accepted.
    const unitIds = content.units.map((unit: any) => unit.id);
    const labelIds = content.labels.map((label: any) => label.id);
    expect(content.targets).toEqual([
      {
        unitId: unitIds[1],
        labelId: labelIds[0],
        note: 'Names the weight before anything else.',
      },
      {
        unitId: unitIds[2],
        labelId: labelIds[1],
        note: 'A fix before she feels heard.',
      },
      { unitId: unitIds[1], labelId: labelIds[2] },
    ]);
    expect(output.summary).toBe('4 lines · 3 labels · 3 answers');
  });

  it('feeds the brief behaviours and the next roleplay into the prompt', async () => {
    const llm = fakeLlm(
      [TRANSCRIPT],
      'H:\n{{helpful_behaviours}}\nU:\n{{unhelpful_behaviours}}\nNext: {{next_practice}}\n{{label_instruction}}',
    );
    await new AnnotationSpecialist(llm.service).generate(makeContext('ann-1'));
    const prompt = llm.promptOf(0);
    expect(prompt).toContain('- Reflects feelings');
    expect(prompt).toContain('- Gives advice too early');
    expect(prompt).toContain('Next: [Roleplay] "Asha goes quiet"');
    expect(prompt).toContain('6 or fewer behaviours');
  });

  it('caps labels at six', async () => {
    const labels = Array.from({ length: 9 }, (_, index) => ({
      id: `l${index}`,
      text: `Behaviour ${index}`,
    }));
    const llm = fakeLlm([
      { ...TRANSCRIPT, labels, targets: [{ unitId: 'u2', labelId: 'l0' }] },
    ]);
    const output = await new AnnotationSpecialist(llm.service).generate(
      makeContext('ann-1'),
    );
    expect((output.content as any).labels).toHaveLength(6);
    expect(
      new Set((output.content as any).labels.map((l: any) => l.color)).size,
    ).toBe(6);
  });

  it('rejects an empty answer key', async () => {
    const llm = fakeLlm([
      { ...TRANSCRIPT, targets: [{ unitId: 'nope', labelId: 'l1' }] },
    ]);
    const error = await new AnnotationSpecialist(llm.service)
      .generate(makeContext('ann-1'))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors[0]).toMatch(/answer key is empty/);
  });
});
