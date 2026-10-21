import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BreathingExerciseContentDto } from '../upsert-track-structure.dto';

describe('BreathingExerciseContentDto', () => {
  const createValidDto = (): BreathingExerciseContentDto => {
    const dto = new BreathingExerciseContentDto();
    dto.inhale = 5;
    dto.holdIn = 5;
    dto.exhale = 5;
    dto.holdOut = 5;
    dto.cycles = 3;
    dto.inhaleText = 'Inhale';
    dto.holdInText = 'Hold';
    dto.exhaleText = 'Exhale';
    dto.holdOutText = 'Hold';
    return dto;
  };

  it('should pass validation with positive durations', async () => {
    const dto = createValidDto();
    const errors = await validate(
      plainToInstance(BreathingExerciseContentDto, dto),
    );
    expect(errors.length).toBe(0);
  });

  it('should fail validation if inhale duration is 0', async () => {
    const dto = createValidDto();
    dto.inhale = 0;
    const errors = await validate(
      plainToInstance(BreathingExerciseContentDto, dto),
    );
    expect(errors.length).toBe(1); // This will fail before the fix
  });

  it('should fail validation if holdIn duration is 0', async () => {
    const dto = createValidDto();
    dto.holdIn = 0;
    const errors = await validate(
      plainToInstance(BreathingExerciseContentDto, dto),
    );
    expect(errors.length).toBe(1); // This will fail before the fix
  });

  it('should fail validation if exhale duration is 0', async () => {
    const dto = createValidDto();
    dto.exhale = 0;
    const errors = await validate(
      plainToInstance(BreathingExerciseContentDto, dto),
    );
    expect(errors.length).toBe(1); // This will fail before the fix
  });

  it('should fail validation if holdOut duration is 0', async () => {
    const dto = createValidDto();
    dto.holdOut = 0;
    const errors = await validate(
      plainToInstance(BreathingExerciseContentDto, dto),
    );
    expect(errors.length).toBe(1); // This will fail before the fix
  });
});
