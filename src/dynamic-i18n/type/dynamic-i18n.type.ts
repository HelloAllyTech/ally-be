export type TranslationValue =
  | string
  | number
  | boolean
  | null
  | TranslationValue[]
  | { [key: string]: TranslationValue };

export type TranslationTree = Record<string, TranslationValue>;

export type I18nManifest = {
  version: number;
  currentVersion: string;
  publishedAt: string;
  languages: string[];
  namespaces: string[];
  files: Record<string, string[]>;
};

export type TranslationEntry = {
  key: string;
  value: string;
  liveValue?: string;
  changed: boolean;
  placeholders: string[];
};

export type TranslationDiffEntry = {
  key: string;
  draftValue?: string;
  liveValue?: string;
  status: 'added' | 'changed' | 'removed' | 'unchanged';
};

export type I18nVersion = {
  version: number;
  name: string;
  current: boolean;
  updatedAt?: string;
};

export type I18nStatus = {
  manifest: I18nManifest | null;
  languages: string[];
  namespaces: string[];
  versions: I18nVersion[];
  retentionLimit: number;
};
