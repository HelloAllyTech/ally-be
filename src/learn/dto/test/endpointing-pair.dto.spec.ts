import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateScenarioDto } from '../update-scenario.dto';

/**
 * EXPERIMENT(turn-endpointing) — delete with the feature.
 *
 * The pair is the whole point: ally-ai-learn throws away a per-sim override
 * unless 0 < min < max, and a rejected override is invisible at runtime (the
 * session just runs on the platform defaults). So the save has to be the thing
 * that refuses, not the voice worker.
 */
describe('UpdateScenarioDto turn endpointing pair', () => {
  const errorsFor = async (
    turnMinEndpointingDelay?: number | null,
    turnMaxEndpointingDelay?: number | null,
  ) => {
    const dto = plainToInstance(UpdateScenarioDto, {
      turnMinEndpointingDelay,
      turnMaxEndpointingDelay,
    });
    const errors = await validate(dto);
    return errors.filter((error) =>
      ['turnMinEndpointingDelay', 'turnMaxEndpointingDelay'].includes(
        error.property,
      ),
    );
  };

  it('accepts a valid pair', async () => {
    expect(await errorsFor(0.3, 1.8)).toHaveLength(0);
  });

  it('treats both-unset as "use the platform defaults"', async () => {
    expect(await errorsFor(undefined, undefined)).toHaveLength(0);
  });

  it('rejects a ceiling at or below the floor', async () => {
    expect(await errorsFor(2.0, 0.5)).not.toHaveLength(0);
    expect(await errorsFor(1.0, 1.0)).not.toHaveLength(0);
  });

  it('rejects a half-configured pair in either direction', async () => {
    expect(await errorsFor(0.3, undefined)).not.toHaveLength(0);
    expect(await errorsFor(undefined, 1.8)).not.toHaveLength(0);
  });

  it('rejects bounds outside the sane range', async () => {
    expect(await errorsFor(0.01, 1.8)).not.toHaveLength(0);
    expect(await errorsFor(0.3, 99)).not.toHaveLength(0);
  });

  it('names the floor in the message so the author can fix it', async () => {
    const [error] = await errorsFor(2.0, 0.5);
    expect(Object.values(error.constraints ?? {}).join(' ')).toContain(
      'turnMinEndpointingDelay',
    );
  });
});
