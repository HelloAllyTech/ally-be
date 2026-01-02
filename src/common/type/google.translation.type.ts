export type TranslateOptions = {
  chunkSize?: number; // number of strings per API request (default 100)
  concurrency?: number; // how many languages to translate in parallel (default: all)
  mimeType?: 'text/plain' | 'text/html';
};
