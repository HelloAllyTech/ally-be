export interface ITTSProvider {
  generatePreview(text: string): Promise<Buffer>;
}
