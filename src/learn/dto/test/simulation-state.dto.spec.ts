import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DialogueLength } from '../../enums/dialogue-length.enum';
import { CreateScenarioDto } from '../create-scenario.dto';
import { SimulationStateDto } from '../simulation-state.dto';

const createState = (dialogueLength?: any): SimulationStateDto => ({
  id: 'test-id',
  name: 'Test State',
  guidelines: 'Test guidelines',
  scoreLower: 0,
  scoreUpper: 100,
  ragEnabled: true,
  dialogueLength,
});

describe('SimulationStateDto dialogueLength validation', () => {
  const errorsFor = async (states: SimulationStateDto[]) => {
    const dto = plainToInstance(CreateScenarioDto, { states });
    const errors = await validate(dto);
    const stateErrors = errors.find((error) => error.property === 'states');
    return stateErrors?.children?.[0].children?.filter(
      (error) => error.property === 'dialogueLength',
    );
  };

  it('should accept valid dialogue length values', async () => {
    let states = [createState(DialogueLength.SHORT)];
    expect(await errorsFor(states)).toBeUndefined();

    states = [createState(DialogueLength.MEDIUM)];
    expect(await errorsFor(states)).toBeUndefined();

    states = [createState(DialogueLength.LONG)];
    expect(await errorsFor(states)).toBeUndefined();
  });

  it('should accept null or undefined', async () => {
    let states = [createState(null)];
    expect(await errorsFor(states)).toBeUndefined();

    states = [createState(undefined)];
    expect(await errorsFor(states)).toBeUndefined();
  });

  it('should reject invalid dialogue length values', async () => {
    const states = [createState('invalid-value')];
    const errors = await errorsFor(states);
    expect(errors).toHaveLength(1);
    expect(errors?.[0].constraints).toHaveProperty('isEnum');
  });

  it('should reject non-string values', async () => {
    const states = [createState(123)];
    const errors = await errorsFor(states);
    expect(errors).toHaveLength(1);
    expect(errors?.[0].constraints).toHaveProperty('isEnum');
  });
});
