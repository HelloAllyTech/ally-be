import { v4 as uuidv4 } from 'uuid';
import { BuilderMessage } from '../../entity/builder-message.entity';
import { BuilderPrdDoc } from '../../entity/builder-prd-doc.entity';
import { BuilderPrdVersion } from '../../entity/builder-prd-version.entity';
import { BuilderEvidence } from '../../entity/builder-evidence.entity';
import { BuilderMessageRole } from '../../enum/builder.enum';

/**
 * In-memory stand-ins for the repositories a Builder interview writes to.
 *
 * The replay runs the real orchestrator, tools, readiness and reviewer, and
 * those talk to repositories. Handing them these instead is what makes a
 * replay a sandbox: it can run against production's database without writing
 * a single builder row — no session, message, PRD version or evidence entry
 * that an admin could later find in their list.
 *
 * Only the methods the interview path calls are implemented, each with the
 * semantics the real one has (append-only versions, monotonic message seq,
 * a draft re-read inside the "transaction"). Anything else throws, so a new
 * call site that writes through a method this does not know fails the eval
 * loudly instead of writing somewhere real.
 */

/** Timestamps that never tie, so "edited after the message" stays decidable. */
class MonotonicClock {
  private last = 0;
  now(): Date {
    this.last = Math.max(Date.now(), this.last + 1);
    return new Date(this.last);
  }
}

const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

export class SandboxStores {
  readonly clock = new MonotonicClock();
  readonly docs = new Map<string, BuilderPrdDoc>();
  readonly versions: BuilderPrdVersion[] = [];
  readonly messages: BuilderMessage[] = [];
  readonly evidence: BuilderEvidence[] = [];

  /** BuilderPrdDocRepository, as BuilderPrdService and the reviewer use it. */
  readonly docRepository = {
    findBySession: async (sessionId: string) => {
      const doc = [...this.docs.values()].find(
        (candidate) => candidate.sessionId === sessionId,
      );
      return doc ? this.copyDoc(doc) : null;
    },
    create: (fields: Partial<BuilderPrdDoc>) =>
      ({ ...fields }) as BuilderPrdDoc,
    save: async (doc: BuilderPrdDoc) => {
      const now = this.clock.now();
      const stored = {
        ...doc,
        id: doc.id ?? uuidv4(),
        review: doc.review ?? null,
        createdAt: doc.createdAt ?? now,
        updatedAt: now,
      } as BuilderPrdDoc;
      this.docs.set(stored.id, clone(stored));
      return this.copyDoc(stored);
    },
    update: async (
      criteria: string | { id: string },
      patch: Partial<BuilderPrdDoc>,
    ) => {
      const id = typeof criteria === 'string' ? criteria : criteria.id;
      const current = this.docs.get(id);
      if (!current) throw new Error(`Sandbox: no PRD doc ${id}`);
      this.docs.set(id, {
        ...current,
        ...clone(patch),
        updatedAt: this.clock.now(),
      });
      return { affected: 1 };
    },
    findOne: async ({ where }: { where: { id: string } }) => {
      const doc = this.docs.get(where.id);
      return doc ? this.copyDoc(doc) : null;
    },
  };

  /** BuilderPrdVersionRepository, as readiness reads it. */
  readonly versionRepository = {
    latestCreatedAt: async (docId: string) => {
      const latest = this.versions
        .filter((version) => version.docId === docId)
        .sort((a, b) => b.versionNumber - a.versionNumber)[0];
      return latest?.createdAt ?? null;
    },
    listByDoc: async (docId: string) =>
      this.versions
        .filter((version) => version.docId === docId)
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map(clone),
  };

  /**
   * The DataSource BuilderPrdService opens its write transaction on. The
   * entity manager it hands back reads and writes the maps above; the version
   * insert enforces the (docId, versionNumber) uniqueness the real index does.
   */
  readonly dataSource = {
    transaction: async <T>(work: (em: any) => Promise<T>): Promise<T> =>
      work({
        getRepository: (entity: unknown) => {
          if (entity === BuilderPrdDoc) {
            return {
              findOneOrFail: async ({ where }: { where: { id: string } }) => {
                const doc = this.docs.get(where.id);
                if (!doc) throw new Error(`Sandbox: no PRD doc ${where.id}`);
                return this.copyDoc(doc);
              },
              update: this.docRepository.update,
            };
          }
          if (entity === BuilderPrdVersion) {
            return {
              create: (fields: Partial<BuilderPrdVersion>) =>
                ({ ...fields }) as BuilderPrdVersion,
              save: async (version: BuilderPrdVersion) => {
                if (
                  this.versions.some(
                    (existing) =>
                      existing.docId === version.docId &&
                      existing.versionNumber === version.versionNumber,
                  )
                ) {
                  throw Object.assign(new Error('duplicate version'), {
                    code: '23505',
                  });
                }
                const now = this.clock.now();
                const stored = {
                  ...clone(version),
                  id: uuidv4(),
                  createdAt: now,
                  updatedAt: now,
                } as BuilderPrdVersion;
                this.versions.push(stored);
                return clone(stored);
              },
            };
          }
          throw new Error(
            `Sandbox: the replay tried to write ${String(
              (entity as { name?: string })?.name ?? entity,
            )}, which it does not keep in memory.`,
          );
        },
      }),
  };

  /** BuilderMessageRepository. */
  readonly messageRepository = {
    listBySession: async (sessionId: string) =>
      this.messages
        .filter((message) => message.sessionId === sessionId)
        .sort((a, b) => a.seq - b.seq)
        .map(clone),
    appendMessage: async (
      sessionId: string,
      message: {
        role: BuilderMessageRole;
        content?: string | null;
        toolCalls?: Record<string, any>[] | null;
        toolResults?: Record<string, any>[] | null;
        metadata?: Record<string, any> | null;
        createdBy?: number;
      },
    ) => {
      const now = this.clock.now();
      const seq =
        this.messages.filter((existing) => existing.sessionId === sessionId)
          .length + 1;
      const stored = {
        id: uuidv4(),
        sessionId,
        seq,
        content: null,
        toolCalls: null,
        toolResults: null,
        metadata: null,
        ...clone(message),
        createdAt: now,
        updatedAt: now,
      } as BuilderMessage;
      this.messages.push(stored);
      return clone(stored);
    },
    checkpointMessage: async (
      messageId: string,
      patch: Partial<BuilderMessage>,
    ) => {
      const message = this.messages.find(
        (candidate) => candidate.id === messageId,
      );
      if (!message) return;
      Object.assign(message, clone(patch), { updatedAt: this.clock.now() });
    },
    closeInterruptedMessages: async (sessionId: string) => {
      let closed = 0;
      for (const message of this.messages) {
        if (
          message.sessionId === sessionId &&
          message.role === BuilderMessageRole.ASSISTANT &&
          message.metadata?.streaming
        ) {
          message.metadata = {
            ...message.metadata,
            streaming: false,
            interrupted: true,
          };
          closed += 1;
        }
      }
      return closed;
    },
  };

  /** BuilderEvidenceRepository, as the evidence log writes and reads it. */
  readonly evidenceRepository = {
    insert: async (row: Partial<BuilderEvidence>) => {
      this.evidence.push({
        id: uuidv4(),
        excerpt: null,
        ...clone(row),
        createdAt: this.clock.now(),
      } as BuilderEvidence);
      return { identifiers: [] };
    },
    listBySession: async (sessionId: string) =>
      this.evidence.filter((row) => row.sessionId === sessionId).map(clone),
  };

  /** BuilderSessionRepository: the orchestrator only ever writes partial updates. */
  readonly sessionRepository = {
    update: async () => ({ affected: 1 }),
  };

  private copyDoc(doc: BuilderPrdDoc): BuilderPrdDoc {
    return clone(doc);
  }
}
