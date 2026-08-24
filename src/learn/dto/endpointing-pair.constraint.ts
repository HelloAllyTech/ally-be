import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MIN_FIELD = 'turnMinEndpointingDelay';
const MAX_FIELD = 'turnMaxEndpointingDelay';

/**
 * EXPERIMENT(turn-endpointing) — TEMPORARY. Delete together with
 * turnMin/MaxEndpointingDelay once a good global pair is promoted to
 * ally-ai-learn's settings.TURN_MIN/MAX_ENDPOINTING_DELAY.
 *
 * Validates the per-simulation turn-endpointing pair: both bounds set, and the
 * ceiling strictly above the floor. Anything else and the voice worker throws
 * the whole pair away and runs on the platform defaults — invisible at runtime,
 * so the save has to be what refuses.
 *
 * Attach to BOTH properties. `@IsOptional()` skips every validator on an
 * undefined value, so a constraint sitting only on the max would never fire for
 * "min set, max missing" — the half-configured case this is here to catch.
 */
@ValidatorConstraint({ name: 'isEndpointingPair', async: false })
export class IsEndpointingPairConstraint implements ValidatorConstraintInterface {
  private failure = '';

  validate(_value: unknown, args: ValidationArguments): boolean {
    const object = args.object as Record<string, unknown>;
    const min = object[MIN_FIELD];
    const max = object[MAX_FIELD];

    const minSet = min !== null && min !== undefined;
    const maxSet = max !== null && max !== undefined;

    if (!minSet && !maxSet) return true;

    if (minSet !== maxSet) {
      this.failure = `${MIN_FIELD} and ${MAX_FIELD} must be set together (or both left unset to use the platform defaults)`;
      return false;
    }

    if (typeof min !== 'number' || typeof max !== 'number') {
      this.failure = `${MIN_FIELD} and ${MAX_FIELD} must both be numbers`;
      return false;
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
