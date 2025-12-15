import { Injectable } from '@nestjs/common';
import { TranslationServiceClient } from '@google-cloud/translate';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
type TranslateOptions = {
  chunkSize?: number; // number of strings per API request (default 100)
  concurrency?: number; // how many languages to translate in parallel (default: all)
  mimeType?: 'text/plain' | 'text/html';
};

@Injectable()
export class GoogleTranslationsService {
  private readonly logger = LoggerService.getInstance(
    GoogleTranslationsService.name,
  );
  private client: any;
  private projectId: string;
  private location = 'global'; // change if you want region-specific models
  constructor(private readonly config: AppConfigService) {
    this.projectId = this.config.googleCloudTranslationConfig.projectId || '';

    // Instantiate the v3 client
    this.client = new TranslationServiceClient();
  }

  // Recursively extract strings and store their path
  private extractStrings(
    obj: any,
    path: (string | number)[] = [],
    out: { path: (string | number)[]; value: string }[] = [],
  ) {
    if (obj === null || obj === undefined) return out;
    if (typeof obj === 'string') {
      out.push({ path: path.slice(), value: obj });
      return out;
    }
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => this.extractStrings(v, [...path, i], out));
      return out;
    }
    if (typeof obj === 'object') {
      Object.keys(obj).forEach((k) =>
        this.extractStrings(obj[k], [...path, k], out),
      );
    }
    return out;
  }

  // Recreate a copy and set a value at the path
  private setAtPath(root: any, path: (string | number)[], value: any) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i];
      const next = path[i + 1];
      if (cur[p] === undefined) {
        cur[p] = typeof next === 'number' ? [] : {};
      }
      cur = cur[p];
    }
    cur[path[path.length - 1]] = value;
  }

  // chunker utility
  private chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // translate multiple strings to a single language, with chunking
  private async translateManyToLangChunked(
    contents: string[],
    targetLanguage: string,
    mimeType: 'text/plain' | 'text/html',
    chunkSize: number,
  ): Promise<string[]> {
    if (!contents || contents.length === 0) return [];

    const chunks = this.chunkArray(contents, chunkSize);
    const parent = this.client.locationPath(this.projectId, this.location);

    const results: string[] = [];
    for (const chunk of chunks) {
      const request = {
        parent,
        contents: chunk,
        mimeType,
        targetLanguageCode: targetLanguage,
      };

      const [response] = await this.client.translateText(request);

      const translated = (response.translations || []).map(
        (t: any) => t.translatedText || '',
      );
      results.push(...translated);
    }

    return results;
  }

  /* ------------ main dynamic function ------------ */

  /**
   * Translate any object's string fields into multiple languages.
   * @param sourceObject - any JSON-able object
   * @param targetLanguages - ISO language codes, e.g. ['fr','es']
   * @param options - chunkSize, concurrency, mimeType
   * @returns Record<lang, translatedObject>
   */
  async translateObjectToLanguages(
    sourceObject: any,
    targetLanguages: string[],
    options: TranslateOptions = {},
  ): Promise<Record<string, any>> {
    const {
      chunkSize = 100,
      concurrency = targetLanguages.length,
      mimeType = 'text/plain',
    } = options;

    // 1) extract strings
    const extracted = this.extractStrings(sourceObject);
    const sourceStrings = extracted.map((e) => e.value);

    // If no strings -> return shallow copies for each language
    if (sourceStrings.length === 0) {
      const emptyResult: Record<string, any> = {};
      for (const lang of targetLanguages)
        emptyResult[lang] = JSON.parse(JSON.stringify(sourceObject));
      return emptyResult;
    }

    // 2) process languages in batches according to concurrency
    // create language groups
    const langBatches: string[][] = [];
    for (let i = 0; i < targetLanguages.length; i += concurrency) {
      langBatches.push(targetLanguages.slice(i, i + concurrency));
    }

    const out: Record<string, any> = {};

    for (const batch of langBatches) {
      // translate this batch in parallel
      const promises = batch.map(async (lang) => {
        try {
          const translatedTexts = await this.translateManyToLangChunked(
            sourceStrings,
            lang,
            mimeType,
            chunkSize,
          );

          // rebuild object
          const translatedObj = JSON.parse(JSON.stringify(sourceObject));
          for (let i = 0; i < extracted.length; i++) {
            this.setAtPath(
              translatedObj,
              extracted[i].path,
              translatedTexts[i],
            );
          }
          return { lang, translatedObj };
        } catch (err) {
          this.logger.error(
            `Translation failed for language ${lang}`,
            err as any,
          );
          return { lang, translatedObj: null };
        }
      });

      const results = await Promise.all(promises);
      for (const r of results) out[r.lang] = r.translatedObj;
    }

    return out;
  }
}
