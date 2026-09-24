import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class IsJsonStringConstraint implements ValidatorConstraintInterface {
  validate(value: any, _args: ValidationArguments) {
    void _args; // Mark _args as used to satisfy no-unused-vars rule
    if (typeof value !== 'string') {
      return true; // Let other validators handle non-string types
    }
    // Only attempt to parse if it looks like a JSON object or array
    const trimmedValue = value.trim();
    if (
      (trimmedValue.startsWith('{') && trimmedValue.endsWith('}')) ||
      (trimmedValue.startsWith('[') && trimmedValue.endsWith(']'))
    ) {
      try {
        JSON.parse(value);
      } catch (_e) {
        void _e; // Mark _e as used to satisfy no-unused-vars rule
        return false; // Malformed JSON string
      }
    }
    return true; // Valid JSON string or not JSON-like
  }

  defaultMessage(_args: ValidationArguments) {
    void _args; // Mark _args as used to satisfy no-unused-vars rule
    return 'Text ($value) is not a valid JSON string.';
  }
}

export function IsJsonString(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsJsonStringConstraint,
    });
  };
}
