import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  Min,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';

const MIN_FIELD = 'turnMinEndpointingDelay';
const MAX_FIELD = 'turnMaxEndpointingDelay';

/**
 * Validates that the global turn-endpointing ceiling is strictly above the
 * floor. Unlike the old per-simulation IsEndpointingPairConstraint, both
 * fields are always required here — there is no "unset = use defaults" case,
 * since this DTO IS the defaults now.
 */
@ValidatorConstraint({ name: 'isTurnEndpointingPair', async: false })
export class IsTurnEndpointingPairConstraint
  implements ValidatorConstraintInterface
{
  private failure = '';

  validate(_value: unknown, args: ValidationArguments): boolean {
    const object = args.object as Record<string, unknown>;
    const min = object[MIN_FIELD];
    const max = object[MAX_FIELD];

    if (typeof min !== 'number' || typeof max !== 'number') {
      // Individual @IsNumber() decorators already report this; nothing more
      // to add here.
      return true;
    }

    if (max <= min) {
      this.failure = `${MAX_FIELD} (${max}) must be greater than ${MIN_FIELD} (${min})`;
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return this.failure;
  }
}

export class UpdateTurnEndpointingSettingsDto {
  @ApiProperty({
    description:
      'Global floor (seconds) for turn detection — the fast path taken when the end-of-utterance model is confident the learner has finished. Must be strictly below turnMaxEndpointingDelay.',
    example: 0.5,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Validate(IsTurnEndpointingPairConstraint)
  turnMinEndpointingDelay!: number;

  @ApiProperty({
    description:
      'Global ceiling (seconds) for turn detection — how long the agent waits for a learner who seems mid-thought before replying anyway. Must be strictly greater than turnMinEndpointingDelay.',
    example: 3.0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Validate(IsTurnEndpointingPairConstraint)
  turnMaxEndpointingDelay!: number;
}

export type TurnEndpointingSettings = {
  turnMinEndpointingDelay: number;
  turnMaxEndpointingDelay: number;
};
