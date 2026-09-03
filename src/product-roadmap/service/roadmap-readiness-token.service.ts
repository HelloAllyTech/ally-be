import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  ROADMAP_READINESS_CRITERIA,
  ROADMAP_READINESS_TOKEN_KEY_LABEL,
  ROADMAP_READINESS_TOKEN_TTL_MS,
} from '../constants/product-roadmap.constants';
import { RoadmapOpportunityEffort } from '../enum/roadmap-opportunity.enum';

/** What `POST ai/readiness` decided, recovered from a token on the way back in. */
export interface VerifiedReadiness {
  /** Criterion ids that did NOT pass. Empty means every graded item was green. */
  failedCriteria: string[];
  /** The size the grader proposed. Informational here — see the note in `verify`. */
  proposedEffort: RoadmapOpportunityEffort | null;
}

/** The signed payload, with short keys because this rides in a request body. */
interface ReadinessTokenPayload {
  /** Payload schema version, for a future change that must stay readable. */
  v: number;
  /** sha256 of the trimmed description that was graded. */
  d: string;
  /** sha256 of the product goal it was graded under. */
  g: string;
  /** sha256 of the criteria id set in force at grading time. */
  c: string;
  /** Criterion ids that did not pass. */
  f: string[];
  /** The proposed size, or null when the grader could not size the draft. */
  e: RoadmapOpportunityEffort | null;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/**
 * Signs the readiness verdict on the way out of `POST ai/readiness`, and verifies it on the way
 * into `POST /opportunities`.
 *
 * ## Why a token rather than re-grading on create
 *
 * The gate has to be enforced where the write happens, or it is not a gate — before this, the
 * whole checklist lived in the admin drawer's `canSave`, and a vote-tier token plus curl filed
 * anything at any size. The obvious fix is to re-run the grader inside `create()`, and it is the
 * wrong one: it puts an LLM call in a write path (latency and cost on every filing), it makes a
 * model outage refuse filings outright, and — worst — the second reading can DISAGREE with the
 * one the filer was shown, so a draft graded green in the drawer gets a red refusal on submit
 * with nothing on screen to explain it.
 *
 * Signing the first reading fixes all three. The verdict the filer saw is the verdict that is
 * spent, the server proves it issued it, and no model is called twice.
 *
 * ## What the signature binds, and why each part
 *
 * - The DESCRIPTION hash and the PRODUCT GOAL hash. These make staleness a server-side rule
 *   rather than a React one: `checkedAgainst` in the drawer reverts the checklist to pending
 *   when either changes, and this is the same rule where it cannot be skipped. Pass a throwaway
 *   sentence, swap in anything, file — that is the bypass this closes.
 * - The CRITERIA FINGERPRINT. Editing ROADMAP_READINESS_CRITERIA is expected (its docblock says
 *   so), and a token issued against the old set must not be spendable against the new one — a
 *   criterion added today would otherwise read as passed on every token in flight. Self-
 *   invalidating, so nobody has to remember.
 * - The EXPIRY. A verdict is a reading of a draft at a moment, not a permanent credential.
 *
 * The product goal is bound even though the grader does not currently read it (checkReadiness
 * grades the description alone). That is deliberate: the drawer treats the goal as an input the
 * verdicts describe, and this service's job is to enforce the client's own contract rather than
 * to quietly narrow it. If the grader starts reading the goal, nothing here changes.
 *
 * ## Key derivation
 *
 * HMAC-SHA256 under a key DERIVED from JWT_ACCESS_SECRET, domain-separated by
 * ROADMAP_READINESS_TOKEN_KEY_LABEL — see that constant for why this is not a new env var and
 * why the label makes it not secret reuse.
 *
 * Everything here fails CLOSED. A tampered, malformed, expired or mismatched token is a 400,
 * never a pass: this is a gate, so "I cannot tell" has to mean "not yet".
 */
@Injectable()
export class RoadmapReadinessTokenService {
  private readonly logger = LoggerService.getInstance(
    RoadmapReadinessTokenService.name,
  );

  constructor(private readonly configService: AppConfigService) {}

  /**
   * Resolved per call rather than in the constructor: reading config at construction time is
   * the module-load-time work the repo's gotchas warn about, and it would make every suite that
   * instantiates this service need a fully populated config.
   */
  private signingKey(): Buffer {
    const secret = this.configService.jwt.accessToken.secret;
    if (!secret) {
      // Not a 400 — the caller did nothing wrong. A service that cannot sign cannot gate, and
      // pretending otherwise would issue tokens nothing can verify.
      throw new Error(
        'JWT_ACCESS_SECRET is not configured; readiness verdicts cannot be signed.',
      );
    }
    return crypto
      .createHmac('sha256', secret)
      .update(ROADMAP_READINESS_TOKEN_KEY_LABEL)
      .digest();
  }

  private static sha256(value: string): string {
    return crypto
      .createHash('sha256')
      .update(value, 'utf8')
      .digest('base64url');
  }

  /**
   * The criteria id set in force right now. Order-independent — a reorder of the array is not a
   * change to what is graded, and invalidating every token in flight over one would be noise.
   */
  private static criteriaFingerprint(): string {
    const ids = ROADMAP_READINESS_CRITERIA.map((c) => c.id)
      .slice()
      .sort()
      .join(',');
    return RoadmapReadinessTokenService.sha256(ids);
  }

  /** Sign one verdict. `description` is trimmed here so callers cannot disagree about it. */
  issue(input: {
    description: string;
    productGoal?: string | null;
    failedCriteria: string[];
    proposedEffort: RoadmapOpportunityEffort | null;
  }): string {
    const payload: ReadinessTokenPayload = {
      v: 1,
      d: RoadmapReadinessTokenService.sha256(input.description.trim()),
      g: RoadmapReadinessTokenService.sha256(input.productGoal ?? ''),
      c: RoadmapReadinessTokenService.criteriaFingerprint(),
      f: input.failedCriteria,
      e: input.proposedEffort,
      exp: Date.now() + ROADMAP_READINESS_TOKEN_TTL_MS,
    };

    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    return `${body}.${this.sign(body)}`;
  }

  private sign(body: string): string {
    return crypto
      .createHmac('sha256', this.signingKey())
      .update(body)
      .digest('base64url');
  }

  /**
   * Verify a token against the draft actually being filed.
   *
   * `proposedEffort` comes back but is NOT what the size rule should be applied to. Correcting a
   * size the model got wrong is an explicit, documented exemption — the drawer lets a human
   * change it without re-running the check, because a re-run would recompute the size and
   * overwrite the correction, which would mean no human could ever override the model. So the
   * size rule is applied to the effort being FILED (see RoadmapOpportunityService.create), and
   * this value is here for logging and for anyone comparing the two later.
   *
   * @throws BadRequestException on anything that is not a token this server issued for this
   * exact draft, still inside its window.
   */
  verify(
    token: string,
    against: { description: string; productGoal?: string | null },
  ): VerifiedReadiness {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('The readiness check result is malformed.');
    }
    const [body, signature] = parts;

    const expected = this.sign(body);
    // Length-checked first: timingSafeEqual throws on a length mismatch rather than returning
    // false, and a caller-supplied signature is any length they like.
    const provided = Buffer.from(signature, 'utf8');
    const computed = Buffer.from(expected, 'utf8');
    if (
      provided.length !== computed.length ||
      !crypto.timingSafeEqual(provided, computed)
    ) {
      this.logger.warn(
        '[ROADMAP] Rejected a readiness token whose signature did not verify.',
      );
      throw new BadRequestException('The readiness check result is not valid.');
    }

    let payload: ReadinessTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      // Signed by us and still unparseable is a bug on our side, not a caller's.
      this.logger.error(
        '[ROADMAP] A correctly signed readiness token did not parse.',
      );
      throw new BadRequestException('The readiness check result is malformed.');
    }

    if (payload.v !== 1) {
      throw new BadRequestException(
        'Please run the readiness check again — its result format has changed.',
      );
    }

    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
      throw new BadRequestException(
        'The readiness check has expired. Please run it again.',
      );
    }

    if (payload.c !== RoadmapReadinessTokenService.criteriaFingerprint()) {
      throw new BadRequestException(
        'The readiness checklist has changed. Please run the check again.',
      );
    }

    const descriptionMatches =
      payload.d ===
      RoadmapReadinessTokenService.sha256(against.description.trim());
    const goalMatches =
      payload.g ===
      RoadmapReadinessTokenService.sha256(against.productGoal ?? '');
    if (!descriptionMatches || !goalMatches) {
      // The interesting rejection, and the one a legitimate filer can hit by editing after a
      // pass. Worded as the drawer words it rather than as a validation failure.
      throw new BadRequestException(
        'This has changed since the readiness check ran. Please run it again.',
      );
    }

    return {
      failedCriteria: Array.isArray(payload.f)
        ? payload.f.filter((id): id is string => typeof id === 'string')
        : [],
      proposedEffort: payload.e ?? null,
    };
  }
}
