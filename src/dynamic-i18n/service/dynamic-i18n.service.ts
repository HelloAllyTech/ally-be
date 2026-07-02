import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { AppConfigService } from 'src/config/config.service';
import { User } from 'src/user/entity/user.entity';
import { In, Repository } from 'typeorm';
import {
  AutoTranslateResult,
  I18nManifest,
  I18nStatus,
  I18nVersion,
  TranslationDiffEntry,
  TranslationEntry,
  TranslationTree,
  TranslationValue,
} from '../type/dynamic-i18n.type';

type ChangeRecord = {
  key: string;
  oldValue?: string;
  newValue: string;
};

type I18nAuditLogEntry = {
  event: string;
  date: Date;
  userName: string;
};

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const VERSION_DIR_REGEX = /^v(\d+)$/;
const PLACEHOLDER_REGEX = /\{\{\s*[\w.-]+\s*\}\}/g;

@Injectable()
export class DynamicI18nService {
  private readonly logger = new Logger(DynamicI18nService.name);
  private publishing = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly openAITranslations: OpenAITranslationsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getStatus(): Promise<I18nStatus> {
    await this.ensureWorkspace();

    const draft = await this.readDraftTranslations();
    const manifest = await this.readManifest();
    const versions = await this.listVersions();

    return {
      manifest,
      languages: Object.keys(draft).sort(),
      namespaces: this.getNamespaces(draft),
      versions,
      retentionLimit: this.retentionLimit,
    };
  }

  async listTranslations(
    language: string,
    namespace: string,
    search?: string,
  ): Promise<{
    language: string;
    namespace: string;
    entries: TranslationEntry[];
  }> {
    this.assertSafeSegment(language, 'language');
    this.assertSafeSegment(namespace, 'namespace');
    await this.ensureWorkspace();

    const draftLanguage = await this.readDraftLanguage(language);
    const draftNamespace = this.getNamespace(draftLanguage, namespace);
    const liveNamespace = await this.readCurrentLiveNamespace(
      language,
      namespace,
    );
    const liveFlat = this.flattenStrings(liveNamespace);
    const query = search?.trim().toLowerCase();

    const entries = this.flattenStrings(draftNamespace)
      .filter((entry) => {
        if (!query) return true;
        return (
          entry.key.toLowerCase().includes(query) ||
          entry.value.toLowerCase().includes(query)
        );
      })
      .map((entry) => {
        const liveValue = liveFlat.find(
          (item) => item.key === entry.key,
        )?.value;
        return {
          ...entry,
          liveValue,
          changed: liveValue !== undefined && liveValue !== entry.value,
          placeholders: this.extractPlaceholders(entry.value),
        };
      });

    return { language, namespace, entries };
  }

  async updateTranslations(dto: {
    language: string;
    namespace: string;
    key?: string;
    value?: string;
    changes?: Record<string, string>;
  }): Promise<{
    language: string;
    namespace: string;
    changedKeys: string[];
  }> {
    this.assertSafeSegment(dto.language, 'language');
    this.assertSafeSegment(dto.namespace, 'namespace');
    await this.ensureWorkspace();

    const changes = this.normalizeChanges(dto);
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException(
        'At least one translation change is required',
      );
    }

    const draftLanguage = await this.readDraftLanguage(dto.language);
    const namespace = this.getNamespace(draftLanguage, dto.namespace);
    const auditChanges: ChangeRecord[] = [];

    for (const [key, newValue] of Object.entries(changes)) {
      if (!key.trim()) {
        throw new BadRequestException('Translation key cannot be empty');
      }
      if (typeof newValue !== 'string') {
        throw new BadRequestException('Translation value must be a string');
      }

      const oldRawValue = this.getDeepValue(namespace, key);
      if (oldRawValue !== undefined && typeof oldRawValue !== 'string') {
        throw new BadRequestException(
          `Translation key "${key}" does not point to a string value`,
        );
      }

      this.validatePlaceholders(key, oldRawValue, newValue);
      this.setDeepValue(namespace, key, newValue);
      auditChanges.push({
        key,
        oldValue: oldRawValue,
        newValue,
      });
    }

    draftLanguage[dto.namespace] = namespace;
    await this.writeDraftLanguage(dto.language, draftLanguage);

    await this.auditLogService.log({
      eventType: 'DYNAMIC_I18N_TRANSLATION_UPDATED',
      details: {
        language: dto.language,
        namespace: dto.namespace,
        changes: auditChanges,
      },
    });

    return {
      language: dto.language,
      namespace: dto.namespace,
      changedKeys: Object.keys(changes),
    };
  }

  async autoTranslateAndSave(dto: {
    namespace: string;
    key: string;
    sourceValue: string;
    sourceLanguage?: string;
    targetLanguages?: string[];
  }): Promise<AutoTranslateResult> {
    this.assertSafeSegment(dto.namespace, 'namespace');
    if (!dto.key.trim()) {
      throw new BadRequestException('Translation key cannot be empty');
    }
    if (!dto.sourceValue.trim()) {
      throw new BadRequestException('Source value cannot be empty');
    }
    if (!this.openAITranslations.isConfigured()) {
      throw new BadRequestException('OpenAI translations are not configured');
    }
    await this.ensureWorkspace();

    const sourceLanguage = dto.sourceLanguage?.trim() || 'en';
    this.assertSafeSegment(sourceLanguage, 'sourceLanguage');

    const draft = await this.readDraftTranslations();
    const existingLanguages = Object.keys(draft);
    const targetLanguages = (
      dto.targetLanguages?.length ? dto.targetLanguages : existingLanguages
    ).filter((lang) => lang !== sourceLanguage);

    for (const lang of targetLanguages)
      this.assertSafeSegment(lang, 'language');

    const values: Record<string, string> = {
      [sourceLanguage]: dto.sourceValue,
    };
    const failed: string[] = [];

    await Promise.all(
      targetLanguages.map(async (lang) => {
        try {
          const translated = await this.openAITranslations.translateText(
            dto.sourceValue,
            lang,
          );
          values[lang] = translated?.trim() ? translated : dto.sourceValue;
          if (!translated?.trim() || translated === dto.sourceValue) {
            failed.push(lang);
          }
        } catch (error) {
          this.logger.error(
            `[autoTranslateAndSave] OpenAI failed for ${lang}: ${(error as Error).message}`,
          );
          values[lang] = dto.sourceValue;
          failed.push(lang);
        }
      }),
    );

    const auditChanges: ChangeRecord[] = [];
    for (const [language, newValue] of Object.entries(values)) {
      const draftLanguage = await this.readDraftLanguageOrEmpty(language);
      const namespace = this.getNamespace(draftLanguage, dto.namespace);
      const oldRawValue = this.getDeepValue(namespace, dto.key);
      if (oldRawValue !== undefined && typeof oldRawValue !== 'string') {
        throw new BadRequestException(
          `Translation key "${dto.key}" does not point to a string value`,
        );
      }
      this.setDeepValue(namespace, dto.key, newValue);
      draftLanguage[dto.namespace] = namespace;
      await this.writeDraftLanguage(language, draftLanguage);
      auditChanges.push({
        key: dto.key,
        oldValue: typeof oldRawValue === 'string' ? oldRawValue : undefined,
        newValue,
      });
    }

    await this.auditLogService.log({
      eventType: AUDIT_EVENTS.DYNAMIC_I18N_TRANSLATION_UPDATED,
      details: {
        namespace: dto.namespace,
        autoTranslated: true,
        sourceLanguage,
        targetLanguages,
        failed,
        changes: auditChanges,
      },
    });

    return {
      namespace: dto.namespace,
      key: dto.key,
      sourceLanguage,
      values,
      failed,
    };
  }

  async getDiff(
    language: string,
    namespace: string,
  ): Promise<{
    language: string;
    namespace: string;
    entries: TranslationDiffEntry[];
  }> {
    this.assertSafeSegment(language, 'language');
    this.assertSafeSegment(namespace, 'namespace');
    await this.ensureWorkspace();

    const draftLanguage = await this.readDraftLanguage(language);
    const draft = this.flattenStrings(
      this.getNamespace(draftLanguage, namespace),
    );
    const live = this.flattenStrings(
      await this.readCurrentLiveNamespace(language, namespace),
    );
    const liveByKey = new Map(live.map((entry) => [entry.key, entry.value]));
    const draftByKey = new Map(draft.map((entry) => [entry.key, entry.value]));
    const allKeys = [
      ...new Set([...draftByKey.keys(), ...liveByKey.keys()]),
    ].sort();

    const entries = allKeys.map((key) => {
      const draftValue = draftByKey.get(key);
      const liveValue = liveByKey.get(key);
      let status: TranslationDiffEntry['status'] = 'unchanged';
      if (draftValue === undefined) status = 'removed';
      else if (liveValue === undefined) status = 'added';
      else if (draftValue !== liveValue) status = 'changed';

      return {
        key,
        draftValue,
        liveValue,
        status,
      };
    });

    return { language, namespace, entries };
  }

  async publish(note?: string): Promise<I18nManifest> {
    if (this.publishing) {
      throw new ConflictException('An i18n publish is already in progress');
    }

    this.publishing = true;
    try {
      await this.ensureWorkspace();
      const draft = await this.readDraftTranslations();
      const languages = Object.keys(draft).sort();
      if (languages.length === 0) {
        throw new BadRequestException('No draft translations are available');
      }

      const namespaces = this.getNamespaces(draft);
      const nextVersion = (await this.getLatestVersionNumber()) + 1;
      const versionName = `v${nextVersion}`;
      const tmpDir = path.join(
        this.rootDir,
        `.${versionName}.tmp-${process.pid}-${Date.now()}`,
      );
      const versionDir = path.join(this.rootDir, versionName);

      await fs.mkdir(tmpDir, { recursive: true });
      try {
        for (const language of languages) {
          for (const namespace of Object.keys(draft[language]).sort()) {
            const namespaceDir = path.join(tmpDir, language);
            await fs.mkdir(namespaceDir, { recursive: true });
            await this.writeJsonFile(
              path.join(namespaceDir, `${namespace}.json`),
              draft[language][namespace],
            );
          }
        }

        await fs.rename(tmpDir, versionDir);
      } catch (error) {
        await this.removeDirectory(tmpDir);
        throw error;
      }

      const manifest: I18nManifest = {
        version: nextVersion,
        currentVersion: versionName,
        publishedAt: new Date().toISOString(),
        languages,
        namespaces,
        files: this.buildFilesMap(draft),
      };

      await this.writeManifest(manifest);
      await this.pruneOldVersions(manifest.currentVersion);

      await this.auditLogService.log({
        eventType: 'DYNAMIC_I18N_PUBLISHED',
        details: {
          version: nextVersion,
          currentVersion: versionName,
          languages,
          namespaces,
          note,
        },
      });

      return manifest;
    } finally {
      this.publishing = false;
    }
  }

  // Called by CI pipelines via x-api-key. Accepts the full repo locale files,
  // finds keys missing from the current draft, adds them, and publishes once.
  // Returns the new manifest if anything was published, or null if already in sync.
  async ciSync(
    locales: Record<string, Record<string, unknown>>,
    note?: string,
  ): Promise<I18nManifest | null> {
    await this.ensureWorkspace();

    const NAMESPACE = 'translation';
    let anyUpdates = false;

    for (const [language, localeContent] of Object.entries(locales)) {
      if (!SAFE_SEGMENT.test(language)) continue;

      const draftLanguage = await this.readDraftLanguageOrEmpty(language);
      const draftNamespace = this.getNamespace(draftLanguage, NAMESPACE);
      const draftKeys = new Set(
        this.flattenStrings(draftNamespace).map((e) => e.key),
      );

      const newEntries = this.flattenStrings(
        localeContent as TranslationTree,
      ).filter((e) => !draftKeys.has(e.key));

      if (newEntries.length === 0) continue;

      this.logger.log(
        `[ciSync] ${language}: adding ${newEntries.length} new key(s)`,
      );

      for (const { key, value } of newEntries) {
        this.setDeepValue(draftNamespace, key, value);
      }

      draftLanguage[NAMESPACE] = draftNamespace;
      await this.writeDraftLanguage(language, draftLanguage);
      anyUpdates = true;
    }

    if (!anyUpdates) {
      this.logger.log('[ciSync] Draft already in sync — skipping publish');
      return null;
    }

    return this.publish(note ?? 'CI sync: auto-added new translation keys');
  }

  async rollback(version: number, note?: string): Promise<I18nManifest> {
    await this.ensureWorkspace();
    const versionName = `v${version}`;
    const versionDir = path.join(this.rootDir, versionName);

    if (!(await this.pathExists(versionDir))) {
      throw new NotFoundException(`i18n version ${versionName} was not found`);
    }

    const translations = await this.readVersionTranslations(versionName);
    const manifest: I18nManifest = {
      version,
      currentVersion: versionName,
      publishedAt: new Date().toISOString(),
      languages: Object.keys(translations).sort(),
      namespaces: this.getNamespaces(translations),
      files: this.buildFilesMap(translations),
    };

    await this.writeManifest(manifest);
    await this.pruneOldVersions(manifest.currentVersion);

    await this.auditLogService.log({
      eventType: 'DYNAMIC_I18N_ROLLED_BACK',
      details: {
        version,
        currentVersion: versionName,
        note,
      },
    });

    return manifest;
  }

  async getAuditLogs(limit = 50, offset = 0): Promise<I18nAuditLogEntry[]> {
    const logs = await this.auditLogService.listByEventTypes(
      [
        'DYNAMIC_I18N_TRANSLATION_UPDATED',
        'DYNAMIC_I18N_PUBLISHED',
        'DYNAMIC_I18N_ROLLED_BACK',
      ],
      limit,
      offset,
    );

    const userIds = [
      ...new Set(
        logs
          .map((log) => log.userId)
          .filter((userId): userId is number => typeof userId === 'number'),
      ),
    ];
    const users =
      userIds.length > 0
        ? await this.userRepository.find({
            where: { id: In(userIds) },
            select: ['id', 'name'],
          })
        : [];
    const usersById = new Map(users.map((user) => [user.id, user.name]));

    return logs.map((log) => ({
      event: this.formatAuditEvent(log.eventType),
      date: log.loggedAt,
      userName: log.userId
        ? (usersById.get(log.userId) ?? 'Unknown user')
        : 'System',
    }));
  }

  private formatAuditEvent(eventType: string): string {
    switch (eventType) {
      case AUDIT_EVENTS.DYNAMIC_I18N_TRANSLATION_UPDATED:
        return 'Translation updated';
      case AUDIT_EVENTS.DYNAMIC_I18N_PUBLISHED:
        return 'Published';
      case AUDIT_EVENTS.DYNAMIC_I18N_ROLLED_BACK:
        return 'Rolled back';
      default:
        return eventType;
    }
  }

  private get rootDir(): string {
    return path.resolve(this.config.i18n.rootDir);
  }

  private get draftDir(): string {
    return path.join(this.rootDir, '.drafts');
  }

  private get manifestPath(): string {
    return path.join(this.rootDir, 'manifest.json');
  }

  private get retentionLimit(): number {
    return Math.max(1, this.config.i18n.versionRetention);
  }

  private async ensureWorkspace(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.draftDir, { recursive: true });

    const draftFiles = await this.listJsonFiles(this.draftDir);
    if (draftFiles.length > 0) return;

    const manifest = await this.readManifest();
    if (manifest?.currentVersion) {
      const liveTranslations = await this.readVersionTranslations(
        manifest.currentVersion,
      );
      await this.writeDraftTranslations(liveTranslations);
      return;
    }

    const seeded = await this.readSeedTranslations();
    if (Object.keys(seeded).length > 0) {
      await this.writeDraftTranslations(seeded);
    }
  }

  private async readSeedTranslations(): Promise<
    Record<string, TranslationTree>
  > {
    const sourceDir =
      this.config.i18n.sourceDir ??
      path.resolve(
        process.cwd(),
        '../ally-web/apps/ally-helpline-dashboard/src/i18n/locales',
      );

    if (!(await this.pathExists(sourceDir))) {
      this.logger.warn(`i18n seed source directory not found: ${sourceDir}`);
      return {};
    }

    const files = await this.listJsonFiles(sourceDir);
    const translations: Record<string, TranslationTree> = {};
    for (const file of files) {
      const language = path.basename(file, '.json');
      if (!SAFE_SEGMENT.test(language)) continue;
      translations[language] = await this.readJsonFile<TranslationTree>(
        path.join(sourceDir, file),
      );
    }

    return translations;
  }

  private async readDraftTranslations(): Promise<
    Record<string, TranslationTree>
  > {
    const files = await this.listJsonFiles(this.draftDir);
    const translations: Record<string, TranslationTree> = {};

    for (const file of files) {
      const language = path.basename(file, '.json');
      if (!SAFE_SEGMENT.test(language)) continue;
      translations[language] = await this.readJsonFile<TranslationTree>(
        path.join(this.draftDir, file),
      );
    }

    return translations;
  }

  private async writeDraftTranslations(
    translations: Record<string, TranslationTree>,
  ): Promise<void> {
    for (const [language, tree] of Object.entries(translations)) {
      await this.writeDraftLanguage(language, tree);
    }
  }

  private async readDraftLanguage(language: string): Promise<TranslationTree> {
    const filePath = path.join(this.draftDir, `${language}.json`);
    if (!(await this.pathExists(filePath))) {
      throw new NotFoundException(
        `Draft translations for ${language} not found`,
      );
    }

    return this.readJsonFile<TranslationTree>(filePath);
  }

  private async readDraftLanguageOrEmpty(
    language: string,
  ): Promise<TranslationTree> {
    const filePath = path.join(this.draftDir, `${language}.json`);
    if (!(await this.pathExists(filePath))) return {};
    return this.readJsonFile<TranslationTree>(filePath);
  }

  private async writeDraftLanguage(
    language: string,
    tree: TranslationTree,
  ): Promise<void> {
    const filePath = path.join(this.draftDir, `${language}.json`);
    await this.writeJsonFileAtomically(filePath, tree);
  }

  private async readCurrentLiveNamespace(
    language: string,
    namespace: string,
  ): Promise<TranslationTree> {
    const manifest = await this.readManifest();
    if (!manifest) return {};

    const filePath = path.join(
      this.rootDir,
      manifest.currentVersion,
      language,
      `${namespace}.json`,
    );
    if (!(await this.pathExists(filePath))) return {};

    return this.readJsonFile<TranslationTree>(filePath);
  }

  private async readVersionTranslations(
    versionName: string,
  ): Promise<Record<string, TranslationTree>> {
    const versionDir = path.join(this.rootDir, versionName);
    const translations: Record<string, TranslationTree> = {};
    const languageEntries = await this.safeReadDir(versionDir);

    for (const languageEntry of languageEntries) {
      if (
        !languageEntry.isDirectory() ||
        !SAFE_SEGMENT.test(languageEntry.name)
      ) {
        continue;
      }

      const languageDir = path.join(versionDir, languageEntry.name);
      const namespaceFiles = await this.listJsonFiles(languageDir);
      translations[languageEntry.name] = {};

      for (const namespaceFile of namespaceFiles) {
        const namespace = path.basename(namespaceFile, '.json');
        if (!SAFE_SEGMENT.test(namespace)) continue;
        translations[languageEntry.name][namespace] =
          await this.readJsonFile<TranslationValue>(
            path.join(languageDir, namespaceFile),
          );
      }
    }

    return translations;
  }

  private async listVersions(): Promise<I18nVersion[]> {
    const manifest = await this.readManifest();
    const entries = await this.safeReadDir(this.rootDir);
    const versions: I18nVersion[] = [];

    for (const entry of entries) {
      const match = VERSION_DIR_REGEX.exec(entry.name);
      if (!entry.isDirectory() || !match) continue;

      const stat = await fs.stat(path.join(this.rootDir, entry.name));
      versions.push({
        version: Number(match[1]),
        name: entry.name,
        current: manifest?.currentVersion === entry.name,
        updatedAt: stat.mtime.toISOString(),
      });
    }

    return versions.sort((a, b) => b.version - a.version);
  }

  private async getLatestVersionNumber(): Promise<number> {
    const versions = await this.listVersions();
    return versions[0]?.version ?? 0;
  }

  private async readManifest(): Promise<I18nManifest | null> {
    if (!(await this.pathExists(this.manifestPath))) {
      return null;
    }

    return this.readJsonFile<I18nManifest>(this.manifestPath);
  }

  private async writeManifest(manifest: I18nManifest): Promise<void> {
    await this.writeJsonFileAtomically(this.manifestPath, manifest);
  }

  private async pruneOldVersions(currentVersion: string): Promise<void> {
    const versions = await this.listVersions();
    const keep = new Set<string>([currentVersion]);

    for (const version of versions) {
      if (keep.size >= this.retentionLimit) break;
      keep.add(version.name);
    }

    await Promise.all(
      versions
        .filter((version) => !keep.has(version.name))
        .map((version) =>
          this.removeDirectory(path.join(this.rootDir, version.name)),
        ),
    );
  }

  private buildFilesMap(
    translations: Record<string, TranslationTree>,
  ): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(translations).map(([language, tree]) => [
        language,
        Object.keys(tree)
          .filter((namespace) => SAFE_SEGMENT.test(namespace))
          .sort()
          .map((namespace) => `${language}/${namespace}.json`),
      ]),
    );
  }

  private getNamespaces(
    translations: Record<string, TranslationTree>,
  ): string[] {
    const namespaces = new Set<string>();
    for (const languageTree of Object.values(translations)) {
      for (const namespace of Object.keys(languageTree)) {
        if (SAFE_SEGMENT.test(namespace)) namespaces.add(namespace);
      }
    }
    return [...namespaces].sort();
  }

  private getNamespace(
    tree: TranslationTree,
    namespace: string,
  ): TranslationTree {
    const value = tree[namespace];
    if (value === undefined) return {};
    if (!this.isObject(value)) {
      throw new BadRequestException(
        `Translation namespace "${namespace}" must be a JSON object`,
      );
    }

    return value;
  }

  private normalizeChanges(dto: {
    key?: string;
    value?: string;
    changes?: Record<string, string>;
  }): Record<string, string> {
    if (dto.changes) return dto.changes;
    if (dto.key === undefined || dto.value === undefined) return {};
    return { [dto.key]: dto.value };
  }

  private flattenStrings(
    value: TranslationValue,
    prefix = '',
  ): Array<{ key: string; value: string }> {
    if (typeof value === 'string') {
      return [{ key: prefix, value }];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        this.flattenStrings(item, `${prefix}[${index}]`),
      );
    }

    if (this.isObject(value)) {
      return Object.entries(value).flatMap(([key, child]) =>
        this.flattenStrings(child, prefix ? `${prefix}.${key}` : key),
      );
    }

    return [];
  }

  private getDeepValue(
    tree: TranslationTree,
    keyPath: string,
  ): TranslationValue | undefined {
    const pathParts = this.parseKeyPath(keyPath);
    let current: TranslationValue = tree;

    for (const part of pathParts) {
      if (typeof part === 'number') {
        if (!Array.isArray(current)) return undefined;
        current = current[part];
      } else {
        if (!this.isObject(current)) return undefined;
        current = current[part];
      }
    }

    return current;
  }

  private setDeepValue(
    tree: TranslationTree,
    keyPath: string,
    value: string,
  ): void {
    const pathParts = this.parseKeyPath(keyPath);
    let current: TranslationValue = tree;

    for (let index = 0; index < pathParts.length - 1; index += 1) {
      const part = pathParts[index];
      const nextPart = pathParts[index + 1];

      if (typeof part === 'number') {
        if (!Array.isArray(current)) {
          throw new BadRequestException(`Invalid array path at "${keyPath}"`);
        }
        if (current[part] === undefined) {
          current[part] = typeof nextPart === 'number' ? [] : {};
        }
        current = current[part];
      } else {
        if (!this.isObject(current)) {
          throw new BadRequestException(`Invalid object path at "${keyPath}"`);
        }
        if (current[part] === undefined) {
          current[part] = typeof nextPart === 'number' ? [] : {};
        }
        current = current[part];
      }
    }

    const lastPart = pathParts[pathParts.length - 1];
    if (typeof lastPart === 'number') {
      if (!Array.isArray(current)) {
        throw new BadRequestException(`Invalid array path at "${keyPath}"`);
      }
      current[lastPart] = value;
      return;
    }

    if (!this.isObject(current)) {
      throw new BadRequestException(`Invalid object path at "${keyPath}"`);
    }
    current[lastPart] = value;
  }

  private parseKeyPath(keyPath: string): Array<string | number> {
    if (!keyPath.trim()) {
      throw new BadRequestException('Translation key cannot be empty');
    }

    const parts: Array<string | number> = [];
    const segments = keyPath.split('.');

    for (const segment of segments) {
      if (!segment) {
        throw new BadRequestException(`Invalid translation key "${keyPath}"`);
      }

      const regex = /([^[\]]+)|\[(\d+)\]/g;
      let match: RegExpExecArray | null;
      let consumed = '';
      while ((match = regex.exec(segment)) !== null) {
        consumed += match[0];
        if (match[1]) parts.push(match[1]);
        if (match[2]) parts.push(Number(match[2]));
      }

      if (consumed !== segment) {
        throw new BadRequestException(`Invalid translation key "${keyPath}"`);
      }
    }

    return parts;
  }

  private validatePlaceholders(
    key: string,
    oldValue: string | undefined,
    newValue: string,
  ): void {
    if (oldValue === undefined) return;

    const oldPlaceholders = this.extractPlaceholders(oldValue);
    const newPlaceholders = this.extractPlaceholders(newValue);

    if (oldPlaceholders.join('|') !== newPlaceholders.join('|')) {
      throw new BadRequestException({
        message: `Placeholder mismatch for translation key "${key}"`,
        key,
        expected: oldPlaceholders,
        received: newPlaceholders,
      });
    }
  }

  private extractPlaceholders(value: string): string[] {
    return [...new Set(value.match(PLACEHOLDER_REGEX) ?? [])]
      .map((placeholder) => placeholder.replace(/\s+/g, ''))
      .sort();
  }

  private assertSafeSegment(value: string, label: string): void {
    if (!SAFE_SEGMENT.test(value)) {
      throw new BadRequestException(`Invalid ${label}: ${value}`);
    }
  }

  private isObject(
    value: TranslationValue | unknown,
  ): value is TranslationTree {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async readJsonFile<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `${JSON.stringify(value, null, 2)}\n`,
      'utf-8',
    );
  }

  private async writeJsonFileAtomically(
    filePath: string,
    value: unknown,
  ): Promise<void> {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await this.writeJsonFile(tmpPath, value);
    await fs.rename(tmpPath, filePath);
  }

  private async listJsonFiles(dir: string): Promise<string[]> {
    const entries = await this.safeReadDir(dir);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  }

  private async safeReadDir(dir: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async removeDirectory(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
