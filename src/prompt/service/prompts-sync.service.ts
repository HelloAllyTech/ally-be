import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PromptsService } from './prompt.service';
import { formatLabel } from '../util/format-label.util';
import { LoggerService } from 'src/logger/logger.service';
import { parseVariablesFromPrompt } from '../util/parse-variables.util';
import { LlmRuntime } from 'src/llm/constants/llm-model-registry.constants';

const PROMPTS_DIR = 'src/prompts';
const META_FILENAME_SUFFIX = '.meta.json';

/** Valid `runtimes` values, from the one registry that defines them. */
const LLM_RUNTIME_NAMES: string[] = Object.values(LlmRuntime);

export interface PromptMeta {
  name?: string;
  description?: string;
  category?: string;
  kind?: string;
  usesBlocks?: string[];
  /**
   * Which runtimes read this prompt. Omit unless you know — an omitted value
   * keeps the model picker's conservative default, and a wrong one offers a
   * model the consuming runtime cannot execute.
   */
  runtimes?: string[];
}

@Injectable()
export class PromptsSyncService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(PromptsSyncService.name);

  constructor(private readonly promptsService: PromptsService) {}

  /**
   * Read optional metadata from subdir/_meta/<stem>.meta.json.
   * Returns null if file missing or invalid.
   */
  private readMeta(dir: string, stem: string): PromptMeta | null {
    const metaPath = path.join(dir, '_meta', `${stem}${META_FILENAME_SUFFIX}`);
    if (!fs.existsSync(metaPath)) return null;
    try {
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const name =
        typeof data.name === 'string' && data.name.trim()
          ? data.name.trim()
          : undefined;
      const description =
        typeof data.description === 'string' && data.description.trim()
          ? data.description.trim()
          : undefined;
      const category =
        typeof data.category === 'string' && data.category.trim()
          ? data.category.trim()
          : undefined;
      const kind =
        typeof data.kind === 'string' && data.kind.trim()
          ? data.kind.trim()
          : undefined;

      // ally-ai-learn prompt metas use "uses_blocks"; accept both snake_case and camelCase.
      const rawUsesBlocks = (data.uses_blocks ?? data.usesBlocks) as
        | unknown
        | undefined;
      const usesBlocks = Array.isArray(rawUsesBlocks)
        ? rawUsesBlocks
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined;

      // Validated against the real runtime names rather than taken on trust:
      // a typo here would silently widen the picker to models the consuming
      // runtime cannot run, which surfaces as a failed session rather than as
      // a bad config.
      const rawRuntimes = data.runtimes as unknown;
      const runtimes = Array.isArray(rawRuntimes)
        ? rawRuntimes
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => LLM_RUNTIME_NAMES.includes(v))
        : undefined;
      if (
        Array.isArray(rawRuntimes) &&
        runtimes?.length !== rawRuntimes.length
      ) {
        this.logger.warn(
          `Prompt meta for "${stem}" names unknown runtime(s); keeping only ` +
            `${JSON.stringify(runtimes)}. Valid: ${LLM_RUNTIME_NAMES.join(', ')}.`,
        );
      }

      if (
        name === undefined &&
        description === undefined &&
        category === undefined &&
        kind === undefined &&
        usesBlocks === undefined &&
        runtimes === undefined
      ) {
        return null;
      }

      return { name, description, category, kind, usesBlocks, runtimes };
    } catch {
      return null;
    }
  }

  async onModuleInit(): Promise<void> {
    // Run sync in background to avoid blocking app startup (e.g. when DB is not ready yet)
    this.syncFromFolder().catch((err) =>
      this.logger.error(`Prompts sync failed: ${err?.message || err}`),
    );
  }

  /**
   * Derive name and description from promptCode via formatLabel.
   * For subdir_filename codes, formats as "Subdir: Filename" / "Subdir prompt — Filename".
   */
  private getNameAndDescription(
    promptCode: string,
    hadSubdir: boolean,
  ): { name: string; description: string } {
    if (hadSubdir && promptCode.includes('_')) {
      const lastUnderscore = promptCode.lastIndexOf('_');
      const subdirPart = promptCode.slice(0, lastUnderscore);
      const filenamePart = promptCode.slice(lastUnderscore + 1);
      return {
        name: `${formatLabel(subdirPart)}: ${formatLabel(filenamePart)}`,
        description: `${formatLabel(subdirPart)} prompt — ${formatLabel(filenamePart)}`,
      };
    }
    const formatted = formatLabel(promptCode);
    return { name: formatted, description: formatted };
  }

  private getCategoryFromRelativePath(relPath: string): string | undefined {
    const [topLevelFolder] = relPath.split(/[/\\]/);
    if (!topLevelFolder || topLevelFolder === relPath) {
      return undefined;
    }
    return formatLabel(topLevelFolder);
  }

  /**
   * Scan prompts folder and sync to DB. Add-only for new; update defaultPrompt for existing.
   */
  async syncFromFolder(): Promise<{ added: number; updated: number }> {
    const promptsDir = path.join(process.cwd(), PROMPTS_DIR);
    if (!fs.existsSync(promptsDir)) {
      this.logger.info(
        `Prompts folder not found at ${promptsDir}, skipping sync`,
      );
      return { added: 0, updated: 0 };
    }

    const items: {
      promptCode: string;
      name: string;
      description: string;
      category?: string;
      prompt: string;
      // Local sync auto-parses placeholders into bare names. Remote
      // sync payloads from ai-learn may include the richer
      // `{ name, label?, required? }` shape; the service accepts both.
      availableVariables: (
        | string
        | { name: string; label?: string; required?: boolean }
      )[];
      kind?: string;
      usesBlocks?: string[];
      runtimes?: string[];
    }[] = [];

    const scanDir = (dir: string, baseDir: string = dir): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '_meta') scanDir(fullPath, baseDir);
        } else if (entry.isFile() && entry.name.endsWith('.txt')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relPath = path.relative(baseDir, fullPath);
          const pathWithoutExt = relPath.replace(/\.txt$/, '');
          const promptCode = pathWithoutExt
            .replace(/\//g, '_')
            .replace(/\\/g, '_');
          const hadSubdir = /[/\\]/.test(pathWithoutExt);
          let { name, description } = this.getNameAndDescription(
            promptCode,
            hadSubdir,
          );
          let category = this.getCategoryFromRelativePath(relPath);
          const stem = path.basename(fullPath, '.txt');
          const meta = this.readMeta(dir, stem);
          let kind: string | undefined;
          let usesBlocks: string[] | undefined;
          let runtimes: string[] | undefined;
          if (meta) {
            if (meta.name !== undefined) name = meta.name;
            if (meta.description !== undefined) description = meta.description;
            if (meta.category !== undefined) category = meta.category;
            if (meta.kind !== undefined) kind = meta.kind;
            if (meta.usesBlocks !== undefined) usesBlocks = meta.usesBlocks;
            if (meta.runtimes !== undefined) runtimes = meta.runtimes;
          }
          items.push({
            promptCode,
            name,
            description,
            category,
            prompt: content.trim(),
            availableVariables: parseVariablesFromPrompt(content),
            kind,
            usesBlocks,
            runtimes,
          });
        }
      }
    };

    scanDir(promptsDir);

    if (items.length === 0) {
      this.logger.info(`No .txt files found in ${promptsDir}`);
      return { added: 0, updated: 0 };
    }

    const result = await this.promptsService.syncPrompts({ prompts: items });
    this.logger.info(
      `Prompts sync: ${result.added} added, ${result.updated} defaultPrompt updated`,
    );
    return result;
  }
}
