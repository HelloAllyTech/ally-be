export interface ITTSProvider {
  generatePreview(text: string, languageCode: string): Promise<Buffer>;
}
