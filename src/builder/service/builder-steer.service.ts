import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSteerRepository } from '../repository/builder-build.repository';
import { BuilderSteer } from '../entity/builder-steer.entity';
import { BuilderSteerStatus } from '../enum/builder.enum';
import { BUILDER_STEER_MAX_LENGTH } from '../constants/builder.constants';

/**
 * Redirecting a build instead of cancelling it.
 *
 * The only lever an admin had over a running build was Cancel, and cancelling
 * throws away the working tree — nothing a run writes is pushed anywhere
 * before FINALISE — plus every dollar spent getting there. So "it is going the
 * wrong way" and "stop everything" had one button between them, and the cost
 * of the wrong choice was an hour.
 *
 * A steer is the missing middle: a sentence that reaches the run at its next
 * phase boundary and rides on the prompt for the phase after it.
 *
 * ## The contract, stated the same way everywhere
 *
 * Delivery is at phase boundaries, and it is delivery — not compliance. A
 * coding agent is one long invocation with no point at which text can be
 * injected, so a note written while the coder is running waits for CODE to
 * end. Nothing here can make the agent obey, and the status vocabulary is
 * careful about that: DELIVERED means a run read it and put it in a prompt.
 * The admin-facing copy says the same thing, because a control that quietly
 * promises more than it does is worse than one that promises nothing.
 *
 * ## Why a run acknowledges rather than the read marking delivery
 *
 * The runner fetches pending notes, appends them to its prompt file, and only
 * then acknowledges. A crash between fetch and append leaves them PENDING and
 * they arrive at the next boundary. If the read marked them delivered, that
 * same crash would swallow a person's correction silently — and the whole
 * point of the feature is that the correction gets through.
 */
@Injectable()
export class BuilderSteerService {
  private readonly logger = LoggerService.getInstance(BuilderSteerService.name);

  constructor(private readonly repository: BuilderSteerRepository) {}

  /**
   * Queue a note. `runId` is whatever was in flight when it was written, for
   * the audit trail — the note is addressed to the session, not to that run,
   * because a retry is a new run and the correction still applies.
   */
  async add(
    sessionId: string,
    note: string,
    options: { runId?: string | null; userId?: number | null } = {},
  ): Promise<BuilderSteer> {
    const text = note?.trim() ?? '';
    if (!text) {
      throw new BadRequestException('A steering note cannot be empty.');
    }
    if (text.length > BUILDER_STEER_MAX_LENGTH) {
      throw new BadRequestException(
        `A steering note is at most ${BUILDER_STEER_MAX_LENGTH} characters. ` +
          'Anything longer is a change to the PRD, not a correction to a run.',
      );
    }

    return this.repository.save(
      this.repository.create({
        sessionId,
        runId: options.runId ?? null,
        note: text,
        status: BuilderSteerStatus.PENDING,
        createdByUserId: options.userId ?? null,
      }),
    );
  }

  listPending(sessionId: string): Promise<BuilderSteer[]> {
    return this.repository.listPending(sessionId);
  }

  listForSession(sessionId: string): Promise<BuilderSteer[]> {
    return this.repository.listBySession(sessionId);
  }

  /**
   * Mark notes as having reached a run's prompt.
   *
   * Scoped to the session's own pending rows rather than trusting the id list
   * outright: the runner is authenticated with the shared pipeline key, and a
   * run must not be able to close out another session's queue by guessing.
   */
  async acknowledge(
    sessionId: string,
    runId: string,
    ids: string[],
    phase?: string,
  ): Promise<number> {
    if (!ids?.length) return 0;
    const pending = await this.repository.listPending(sessionId);
    const own = pending.filter((steer) => ids.includes(steer.id));
    if (!own.length) return 0;

    await this.repository.update(
      own.map((steer) => steer.id),
      {
        status: BuilderSteerStatus.DELIVERED,
        deliveredAt: new Date(),
        deliveredToRunId: runId,
        deliveredAtPhase: phase ?? null,
      },
    );
    this.logger.info(
      `[BUILDER_STEER] session=${sessionId} run=${runId} delivered=${own.length}` +
        (phase ? ` phase=${phase}` : ''),
    );
    return own.length;
  }

  /**
   * Close out anything nobody will ever read — a session that finished, or a
   * note the admin withdrew. Not DELIVERED: it never was.
   */
  async supersedePending(sessionId: string): Promise<number> {
    const pending = await this.repository.listPending(sessionId);
    if (!pending.length) return 0;
    await this.repository.update(
      pending.map((steer) => steer.id),
      { status: BuilderSteerStatus.SUPERSEDED },
    );
    return pending.length;
  }
}
