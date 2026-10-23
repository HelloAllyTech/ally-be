import { TransformFnParams } from 'class-transformer';

export const EmptyStringToUndefinedTransform = ({
  value,
}: TransformFnParams): string | undefined => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};
