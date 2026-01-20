export type MetadataShape = {
  title?: string;
  description?: string;
  tone?: string;
  personality?: string;
  context?: string;
  openingStatements?: string[];
  sexualOrientation?: string;
  genderIdentity?: string;
  customFields?: { name: string; value: string }[];
};
