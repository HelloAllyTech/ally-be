export const TrimStringTransform = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
