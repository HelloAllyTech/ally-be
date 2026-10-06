import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  FhsHumanRatingSampleQueryDto,
  SubmitFhsHumanRatingDto,
} from '../dto/fhs-human-rating.dto';

const errorsOf = async (cls: any, plain: unknown) =>
  (await validate(plainToInstance(cls, plain) as object)).map(
    (e) => e.property,
  );

describe('human rating DTOs (transport validation; rubric checks live in the service)', () => {
  it('accepts a well-formed submission', async () => {
    expect(
      await errorsOf(SubmitFhsHumanRatingDto, {
        cutId: '11111111-1111-4111-8111-111111111111',
        ticks: [
          { skill: 'verbal', opportunity: true, observed: ['verbal.b1'] },
          { skill: 'hope', opportunity: false },
        ],
        anyUnhelpful: false,
      }),
    ).toEqual([]);
  });

  it('rejects a non-uuid cut, a non-array ticks and a non-boolean opportunity', async () => {
    expect(
      await errorsOf(SubmitFhsHumanRatingDto, {
        cutId: 'nope',
        ticks: [{ skill: 'verbal', opportunity: 'yes' }],
      }),
    ).toEqual(['cutId', 'ticks']);
    expect(
      await errorsOf(SubmitFhsHumanRatingDto, {
        cutId: '11111111-1111-4111-8111-111111111111',
        ticks: 'verbal',
      }),
    ).toEqual(['ticks']);
  });

  it('rejects non-string codes', async () => {
    expect(
      await errorsOf(SubmitFhsHumanRatingDto, {
        cutId: '11111111-1111-4111-8111-111111111111',
        ticks: [{ skill: 'verbal', opportunity: true, observed: [1] }],
      }),
    ).toEqual(['ticks']);
  });

  it('takes an optional YYYYQn quarter', async () => {
    expect(await errorsOf(FhsHumanRatingSampleQueryDto, {})).toEqual([]);
    expect(
      await errorsOf(FhsHumanRatingSampleQueryDto, { quarter: '2026Q3' }),
    ).toEqual([]);
    expect(
      await errorsOf(FhsHumanRatingSampleQueryDto, { quarter: '2026-Q3' }),
    ).toEqual(['quarter']);
  });
});
