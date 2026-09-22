import { EventBuilderService } from '../event-builder.service';
import { EventBuilderField } from '../../enum/event-builder-field.enum';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { GenerateEventBuilderFieldDto } from '../../dto/generate-event-builder-field.dto';

/**
 * The service itself is thin — render variables, pick a prompt, parse. What it
 * is worth pinning down is the wiring the frontend depends on and a reviewer
 * cannot see from the types: which prompt each field resolves to, which fields
 * receive `className`, and that every call is billed as an Event Builder call
 * rather than inheriting the Agent Builder Copilot's label.
 */
describe('EventBuilderService', () => {
  let service: EventBuilderService;
  let generateContentFromPrompt: jest.Mock;

  const dto = (
    overrides: Partial<GenerateEventBuilderFieldDto> = {},
  ): GenerateEventBuilderFieldDto =>
    ({
      field: EventBuilderField.CLASSIFIER,
      eventDescription: 'The counsellor asks an open-ended question.',
      ...overrides,
    }) as GenerateEventBuilderFieldDto;

  /** Positional args of `AutofillService.generateContentFromPrompt`. */
  const lastCall = () => {
    const calls = generateContentFromPrompt.mock.calls;
    const [
      promptCode,
      variables,
      expectJson,
      model,
      temperature,
      provider,
      task,
    ] = calls[calls.length - 1];
    return {
      promptCode,
      variables,
      expectJson,
      model,
      temperature,
      provider,
      task,
    };
  };

  beforeEach(() => {
    generateContentFromPrompt = jest.fn().mockResolvedValue('{}');
    service = new EventBuilderService({
      generateContentFromPrompt,
    } as any);
  });

  it('resolves each field to its own prompt file', async () => {
    const expected: [EventBuilderField, string][] = [
      [EventBuilderField.CLASSIFIER, 'event_builder_classifier'],
      [EventBuilderField.EXAMPLES, 'event_builder_examples'],
      [EventBuilderField.FEEDBACK, 'event_builder_feedback'],
      [
        EventBuilderField.BRANCH_INSTRUCTION,
        'event_builder_branch_instruction',
      ],
      [EventBuilderField.TAGS, 'event_builder_tags'],
    ];
    for (const [field, promptCode] of expected) {
      await service.generateField(dto({ field }));
      expect(lastCall().promptCode).toBe(promptCode);
    }
  });

  it('bills every call as an Event Builder call', async () => {
    await service.generateField(dto());
    expect(lastCall().task).toBe(LlmTask.AUTOFILL_EVENT_FIELD);
  });

  it('asks for JSON everywhere except the prose branch instruction', async () => {
    await service.generateField(dto({ field: EventBuilderField.EXAMPLES }));
    expect(lastCall().expectJson).toBe(true);

    await service.generateField(
      dto({ field: EventBuilderField.BRANCH_INSTRUCTION }),
    );
    expect(lastCall().expectJson).toBe(false);
  });

  it('passes className to the fields that read it', async () => {
    for (const field of [
      EventBuilderField.EXAMPLES,
      EventBuilderField.FEEDBACK,
      EventBuilderField.BRANCH_INSTRUCTION,
    ]) {
      await service.generateField(dto({ field, className: 'Open question' }));
      expect(lastCall().variables.className).toBe('Open question');
    }
  });

  it('withholds className from classifier, so a regenerate is not a no-op', async () => {
    await service.generateField(
      dto({ field: EventBuilderField.CLASSIFIER, className: 'Open question' }),
    );
    expect(lastCall().variables.className).toBe('');
  });

  it('clamps the example count into the runtime budget', async () => {
    await service.generateField(
      dto({ field: EventBuilderField.EXAMPLES, numExamples: 99 }),
    );
    expect(lastCall().variables.numExamples).toBe('5');

    await service.generateField(
      dto({ field: EventBuilderField.EXAMPLES, numExamples: 0 }),
    );
    expect(lastCall().variables.numExamples).toBe('1');
  });

  it('defaults every optional variable to an empty string, never "undefined"', async () => {
    await service.generateField(dto());
    const { variables } = lastCall();
    expect(variables.simulationContext).toBe('');
    expect(variables.competency).toBe('');
    expect(variables.className).toBe('');
  });

  it('forwards model, provider and temperature overrides', async () => {
    await service.generateField(
      dto({ model: 'gpt-5-mini', provider: 'openai', temperature: 0.4 }),
    );
    const call = lastCall();
    expect(call.model).toBe('gpt-5-mini');
    expect(call.provider).toBe('openai');
    expect(call.temperature).toBe(0.4);
  });

  it('returns the parsed value alongside the field it answers for', async () => {
    generateContentFromPrompt.mockResolvedValue(
      '{"name":"Open-Ended Question","className":"Open-ended question"}',
    );
    await expect(service.generateField(dto())).resolves.toEqual({
      field: EventBuilderField.CLASSIFIER,
      value: {
        name: 'Open-Ended Question',
        className: 'Open-ended question',
      },
    });
  });
});
