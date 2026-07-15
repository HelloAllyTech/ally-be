import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GenerateCoverImageRequestDto } from '../generate-cover-image.dto';

describe('GenerateCoverImageRequestDto', () => {
  const validateDto = async (payload: Record<string, unknown>) => {
    const dto = plainToInstance(GenerateCoverImageRequestDto, payload);
    return validate(dto);
  };

  it('accepts a minimal payload with just a title', async () => {
    const errors = await validateDto({ title: 'Difficult Feedback' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a full payload with a valid provider', async () => {
    const errors = await validateDto({
      title: 'Difficult Feedback',
      description: 'Practice giving critical feedback to a defensive report.',
      styleHints: 'Photorealistic',
      provider: 'gemini',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing or empty title', async () => {
    expect(await validateDto({})).not.toHaveLength(0);
    expect(await validateDto({ title: '   ' })).not.toHaveLength(0);
  });

  it('rejects an unknown provider', async () => {
    const errors = await validateDto({ title: 'X', provider: 'anthropic' });
    expect(errors.some((e) => e.property === 'provider')).toBe(true);
  });

  it('rejects an over-long description', async () => {
    const errors = await validateDto({
      title: 'X',
      description: 'x'.repeat(5001),
    });
    expect(errors.some((e) => e.property === 'description')).toBe(true);
  });
});
