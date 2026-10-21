import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { BuilderEvalFixture } from '../../entity/builder-eval-fixture.entity';
import { BuilderMessage } from '../../entity/builder-message.entity';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { BuilderMessageRepository } from '../../repository/builder-message.repository';
import { BuilderPrdService } from '../../service/builder-prd.service';
import { BuilderSessionService } from '../../service/builder-session.service';
import { freeTextOf } from '../../service/builder-readiness.service';
import { BuilderPrdDocument } from '../../type/builder-prd.type';
import {
  BuilderEvalChecklistItem,
  BuilderEvalFixtureKind,
  BuilderEvalInterviewPayload,
  BuilderEvalPayload,
  BuilderEvalPrdReviewPayload,
} from '../type/builder-eval.type';

const ANSWER_PREFIX = /^\[answers question [^\]]*\]\s*/;

/** A checklist as a person sends it: ids optional, filled in on save. */
type ChecklistInput = Partial<BuilderEvalChecklistItem>[];

/** A fixture as it travels between environments: everything but the ids. */
export interface BuilderEvalFixtureExport {
  name: string;
  kind: BuilderEvalFixtureKind;
  sourceSessionId?: string | null;
  payload: BuilderEvalPayload;
  notes?: string | null;
  active?: boolean;
}

/** What a session looks like when it arrives as an export (GET /v1/builder/sessions/:id). */
export interface BuilderSessionExport {
  id?: string;
  title?: string;
  messages?: Partial<BuilderMessage>[];
  prd?: BuilderPrdDocument | null;
  handoffContext?: string | null;
}

/**
 * The admin's words from a transcript, in order: the opening message and the
 * script after it. A card pick contributes its option labels (the content
 * already holds them), so the simulated admin can pick the same options.
 */
export function adminWordsFrom(messages: Partial<BuilderMessage>[]): {
  openingMessage: string;
  adminScript: string[];
} {
  const words = messages
    .filter((message) => message.role === BuilderMessageRole.USER)
    .map(
      (message) =>
        freeTextOf(message as BuilderMessage) ??
        String(message.content ?? '')
          .replace(ANSWER_PREFIX, '')
          .trim(),
    )
    .filter(Boolean);
  return { openingMessage: words[0] ?? '', adminScript: words.slice(1) };
}

/** Checklist items as stored: ids filled in, kinds valid, blanks dropped. */
export function normaliseChecklist(raw: unknown): BuilderEvalChecklistItem[] {
  const items = Array.isArray(raw) ? raw : [];
  const out: BuilderEvalChecklistItem[] = [];
  for (const item of items) {
    const text = String(item?.text ?? '').trim();
    if (!text) continue;
    out.push({
      id: String(item?.id ?? '').trim() || `C${out.length + 1}`,
      text: text.slice(0, 600),
      kind: item?.kind === 'must_not' ? 'must_not' : 'must',
    });
  }
  return out;
}

function validatePayload(
  kind: BuilderEvalFixtureKind,
  payload: BuilderEvalPayload,
): BuilderEvalPayload {
  if (kind === 'interview') {
    const interview = payload as BuilderEvalInterviewPayload;
    if (!String(interview?.openingMessage ?? '').trim()) {
      throw new BadRequestException(
        'An interview fixture needs the opening message the admin started with.',
      );
    }
    return {
      ...interview,
      adminScript: Array.isArray(interview.adminScript)
        ? interview.adminScript.map(String)
        : [],
      checklist: normaliseChecklist(interview.checklist),
    };
  }
  const review = payload as BuilderEvalPrdReviewPayload;
  if (!review?.prd || typeof review.prd !== 'object') {
    throw new BadRequestException(
      'A prd_review fixture needs the PRD to review.',
    );
  }
  if (typeof review?.expect?.blocking !== 'boolean') {
    throw new BadRequestException(
      'A prd_review fixture must say whether the critic should block (expect.blocking).',
    );
  }
  return review;
}

/**
 * The eval's fixtures: recorded interviews with a person's checklist.
 *
 * Cut from a live session in this environment, or from a session export —
 * which is how a production interview becomes a fixture on a laptop without
 * ever passing through a file in a repo. Export and import carry fixtures
 * between environments the same way.
 */
@Injectable()
export class BuilderEvalFixtureService {
  private readonly repository: Repository<BuilderEvalFixture>;

  constructor(
    dataSource: DataSource,
    private readonly sessionService: BuilderSessionService,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly prdService: BuilderPrdService,
  ) {
    this.repository = dataSource.getRepository(BuilderEvalFixture);
  }

  list(): Promise<BuilderEvalFixture[]> {
    return this.repository.find({ order: { name: 'ASC' } });
  }

  async get(id: string): Promise<BuilderEvalFixture> {
    const fixture = await this.repository.findOne({ where: { id } });
    if (!fixture) throw new NotFoundException('No such eval fixture.');
    return fixture;
  }

  findMany(ids: string[]): Promise<BuilderEvalFixture[]> {
    return ids.length
      ? this.repository.find({ where: { id: In(ids) } })
      : Promise.resolve([]);
  }

  listActive(): Promise<BuilderEvalFixture[]> {
    return this.repository.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  async create(
    input: {
      name: string;
      kind: BuilderEvalFixtureKind;
      payload: BuilderEvalPayload;
      notes?: string | null;
      sourceSessionId?: string | null;
      active?: boolean;
    },
    userId: number,
  ): Promise<BuilderEvalFixture> {
    const name = String(input.name ?? '')
      .trim()
      .slice(0, 120);
    if (!name) throw new BadRequestException('Give the fixture a name.');
    if (await this.repository.findOne({ where: { name } })) {
      throw new ConflictException(`A fixture named "${name}" already exists.`);
    }
    return this.repository.save(
      this.repository.create({
        name,
        kind: input.kind,
        payload: validatePayload(input.kind, input.payload),
        notes: input.notes ?? null,
        sourceSessionId: input.sourceSessionId ?? null,
        active: input.active ?? true,
        createdBy: userId,
      }),
    );
  }

  /** "Save as eval fixture" on a session in this environment. */
  async createFromSession(
    sessionId: string,
    input: {
      name: string;
      checklist?: ChecklistInput;
      notes?: string | null;
      pins?: Record<string, string>;
      /** False for a fixture a person has yet to review (the corrections loop's). */
      active?: boolean;
    },
    userId: number,
  ): Promise<BuilderEvalFixture> {
    const session = await this.sessionService.getSession(sessionId);
    const [messages, doc, handoffContext] = await Promise.all([
      this.messageRepository.listBySession(sessionId),
      this.prdService.getOrCreateDoc(sessionId, userId),
      this.sessionService.getHandoffContext(sessionId),
    ]);
    return this.createFromExport(
      {
        id: session.id,
        title: session.title,
        messages,
        prd: doc.draft,
        handoffContext,
      },
      input,
      userId,
    );
  }

  /** The same, from a session export pasted in from another environment. */
  async createFromExport(
    exported: BuilderSessionExport,
    input: {
      name: string;
      checklist?: ChecklistInput;
      notes?: string | null;
      pins?: Record<string, string>;
      /** False for a fixture a person has yet to review (the corrections loop's). */
      active?: boolean;
    },
    userId: number,
  ): Promise<BuilderEvalFixture> {
    const messages = Array.isArray(exported?.messages) ? exported.messages : [];
    const { openingMessage, adminScript } = adminWordsFrom(messages);
    if (!openingMessage) {
      throw new BadRequestException(
        'That session has no admin message to replay from.',
      );
    }
    const payload: BuilderEvalInterviewPayload = {
      openingMessage,
      adminScript,
      handoffContext: exported.handoffContext ?? null,
      checklist: normaliseChecklist(input.checklist),
      recordedPrd: exported.prd ?? null,
      ...(input.pins ? { pins: input.pins } : {}),
    };
    return this.create(
      {
        name: input.name,
        kind: 'interview',
        payload,
        notes: input.notes ?? null,
        sourceSessionId: exported.id ?? null,
        active: input.active,
      },
      userId,
    );
  }

  async update(
    id: string,
    changes: {
      name?: string;
      notes?: string | null;
      active?: boolean;
      checklist?: ChecklistInput;
      payload?: BuilderEvalPayload;
    },
  ): Promise<BuilderEvalFixture> {
    const fixture = await this.get(id);
    if (changes.name !== undefined) {
      const name = changes.name.trim().slice(0, 120);
      if (!name) throw new BadRequestException('Give the fixture a name.');
      fixture.name = name;
    }
    if (changes.notes !== undefined) fixture.notes = changes.notes;
    if (changes.active !== undefined) fixture.active = changes.active;
    if (changes.payload !== undefined) {
      fixture.payload = validatePayload(fixture.kind, changes.payload);
    }
    if (changes.checklist !== undefined && fixture.kind === 'interview') {
      fixture.payload = {
        ...(fixture.payload as BuilderEvalInterviewPayload),
        checklist: normaliseChecklist(changes.checklist),
      };
    }
    return this.repository.save(fixture);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.repository.delete({ id });
  }

  async exportFixtures(ids?: string[]): Promise<{
    version: 1;
    fixtures: BuilderEvalFixtureExport[];
  }> {
    const fixtures = ids?.length ? await this.findMany(ids) : await this.list();
    return {
      version: 1,
      fixtures: fixtures.map(
        ({ name, kind, sourceSessionId, payload, notes, active }) => ({
          name,
          kind,
          sourceSessionId,
          payload,
          notes,
          active,
        }),
      ),
    };
  }

  /** Upsert by name, so re-importing a refreshed export updates in place. */
  async importFixtures(
    fixtures: BuilderEvalFixtureExport[],
    userId: number,
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const incoming of fixtures ?? []) {
      const kind: BuilderEvalFixtureKind =
        incoming?.kind === 'prd_review' ? 'prd_review' : 'interview';
      const name = String(incoming?.name ?? '')
        .trim()
        .slice(0, 120);
      if (!name) continue;
      const payload = validatePayload(kind, incoming.payload);
      const existing = await this.repository.findOne({ where: { name } });
      if (existing) {
        await this.repository.save({
          ...existing,
          kind,
          payload,
          notes: incoming.notes ?? existing.notes ?? null,
          active: incoming.active ?? existing.active,
          sourceSessionId:
            incoming.sourceSessionId ?? existing.sourceSessionId ?? null,
        });
        updated += 1;
      } else {
        await this.repository.save(
          this.repository.create({
            name,
            kind,
            payload,
            notes: incoming.notes ?? null,
            active: incoming.active ?? true,
            sourceSessionId: incoming.sourceSessionId ?? null,
            createdBy: userId,
          }),
        );
        created += 1;
      }
    }
    return { created, updated };
  }
}
