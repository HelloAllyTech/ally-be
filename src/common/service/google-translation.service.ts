import { Injectable } from '@nestjs/common';
import { TranslationServiceClient } from '@google-cloud/translate';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { TranslateOptions } from '../type/google.translation.type';

@Injectable()
export class GoogleTranslationsService {
  private readonly logger = LoggerService.getInstance(
    GoogleTranslationsService.name,
  );

  private translationClient: TranslationServiceClient;
  private projectId: string;
  private readonly location = 'global';

  constructor(private readonly configService: AppConfigService) {
    this.projectId =
      this.configService.googleCloudTranslationConfig.projectId || '';

    this.translationClient = new TranslationServiceClient();
  }

  /* ------------------------------------------------------------------
   * Utility: Recursively extract all string values and their paths
   * ------------------------------------------------------------------ */
  private extractStringsFromObject(
    sourceValue: any,
    currentPath: (string | number)[] = [],
    extractedStrings: { path: (string | number)[]; value: string }[] = [],
  ): { path: (string | number)[]; value: string }[] {
    if (sourceValue === null || sourceValue === undefined) {
      return extractedStrings;
    }

    if (typeof sourceValue === 'string') {
      extractedStrings.push({
        path: [...currentPath],
        value: sourceValue,
      });
      return extractedStrings;
    }

    if (Array.isArray(sourceValue)) {
      sourceValue.forEach((childValue, index) =>
        this.extractStringsFromObject(
          childValue,
          [...currentPath, index],
          extractedStrings,
        ),
      );
      return extractedStrings;
    }

    if (typeof sourceValue === 'object') {
      Object.keys(sourceValue).forEach((key) =>
        this.extractStringsFromObject(
          sourceValue[key],
          [...currentPath, key],
          extractedStrings,
        ),
      );
    }

    return extractedStrings;
  }

  /* ------------------------------------------------------------------
   * Utility: Set a value inside an object using a path
   * ------------------------------------------------------------------ */
  private setValueAtPath(
    rootObject: any,
    path: (string | number)[],
    valueToSet: any,
  ): void {
    let currentNode = rootObject;

    for (let index = 0; index < path.length - 1; index++) {
      const pathKey = path[index];
      const nextPathKey = path[index + 1];

      if (currentNode[pathKey] === undefined) {
        currentNode[pathKey] = typeof nextPathKey === 'number' ? [] : {};
      }

      currentNode = currentNode[pathKey];
    }

    currentNode[path[path.length - 1]] = valueToSet;
  }

  /* ------------------------------------------------------------------
   * Utility: Split array into chunks
   * ------------------------------------------------------------------ */
  private chunkArray<T>(items: T[], chunkSize: number): T[][] {
    const result: T[][] = [];

    for (let index = 0; index < items.length; index += chunkSize) {
      result.push(items.slice(index, index + chunkSize));
    }

    return result;
  }

  /* ------------------------------------------------------------------
   * Translate multiple strings into one language with chunking
   * ------------------------------------------------------------------ */
  private async translateStringsToLanguage(
    sourceStrings: string[],
    targetLanguageCode: string,
    mimeType: 'text/plain' | 'text/html',
    chunkSize: number,
  ): Promise<string[]> {
    if (!sourceStrings.length) {
      return [];
    }

    const parentPath = this.translationClient.locationPath(
      this.projectId,
      this.location,
    );

    const stringChunks = this.chunkArray(sourceStrings, chunkSize);
    const translatedResults: string[] = [];

    for (const chunk of stringChunks) {
      const request = {
        parent: parentPath,
        contents: chunk,
        mimeType,
        targetLanguageCode,
      };

      const [response] = await this.translationClient.translateText(request);

      const translatedTexts = (response.translations || []).map(
        (translation: any) => translation.translatedText || '',
      );

      translatedResults.push(...translatedTexts);
    }

    return translatedResults;
  }

  /* ------------------------------------------------------------------
   * PUBLIC API
   * Translate any object's string fields into multiple languages
   * ------------------------------------------------------------------ */
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
    const extracted = this.extractStringsFromObject(sourceObject);
    const sourceStrings = extracted.map((e) => e.value);

    // If no strings -> return shallow copies for each language
    if (sourceStrings.length === 0) {
      const emptyResult: Record<string, any> = {};
      for (const language of targetLanguages)
        emptyResult[language] = JSON.parse(JSON.stringify(sourceObject));
      return emptyResult;
    }

    // 2) process languages in batches according to concurrency
    // create language groups
    const langBatches: string[][] = [];
    for (let i = 0; i < targetLanguages.length; i += concurrency) {
      langBatches.push(targetLanguages.slice(i, i + concurrency));
    }

    const translatedResult: Record<string, any> = {};

    for (const batch of langBatches) {
      // translate this batch in parallel
      const promises = batch.map(async (language) => {
        try {
          const translatedTexts = await this.translateStringsToLanguage(
            sourceStrings,
            language,
            mimeType,
            chunkSize,
          );

          // rebuild object
          const translatedObj = JSON.parse(JSON.stringify(sourceObject));
          for (let i = 0; i < extracted.length; i++) {
            this.setValueAtPath(
              translatedObj,
              extracted[i].path,
              translatedTexts[i],
            );
          }
          return { language, translatedObj };
        } catch (err) {
          this.logger.error(
            `Translation failed for language ${language}`,
            err as any,
          );
          return { language, translatedObj: null };
        }
      });

      const batchResults = await Promise.all(promises);
      for (const result of batchResults)
        translatedResult[result.language] = result.translatedObj;
    }

    return translatedResult;
  }
}
