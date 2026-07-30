import { OpportunityResponseDto } from '../dto/roadmap-response.dto';

/**
 * Events the roadmap emits to connected clients. A discriminated union so every `emit()` call
 * site is type-checked — a typo'd event name is a compile error, not a socket message nobody
 * receives.
 *
 * TWO TIERS, deliberately.
 *
 * Tier 1 — targeted deltas for the high-frequency hot path. ALLOCATION_CHANGED is by far the
 * highest-volume event (a debounced number input, several people voting at once), so it carries
 * ~100 bytes and the client patches one number in place.
 *
 * Tier 2 — ROADMAP_INVALIDATED, one signal for rare but structurally sweeping changes. A split
 * can create N opportunities and rewrite hundreds of allocation rows; a merge deletes N and
 * rolls up hundreds; and an owner RENAME cascades through the FK to an unbounded number of
 * opportunity rows that ally-be never touched, so it literally cannot enumerate the delta
 * without re-querying. Writing delta code for operations an admin performs a few times a week
 * is a bad trade.
 *
 * `actorId` is on EVERY event and is a hard contract: the client suppresses its own echo with
 * it. Without it, your own coin click round-trips a broadcast that invalidates the list and
 * refetches over your optimistic patch while your finger is still on the button.
 */
export type RoadmapEvent =
  | {
      kind: 'ALLOCATION_CHANGED';
      actorId: number;
      opportunityId: string;
      periodKey: string;
      coins: number;
      /** Recomputed total across all users and periods, so the client patches rather than refetches. */
      priorityScore: number;
    }
  | {
      kind: 'OPPORTUNITY_UPSERTED';
      actorId: number;
      /** The same shape the REST endpoints return, so the client has one code path. */
      opportunity: OpportunityResponseDto;
    }
  | { kind: 'OPPORTUNITY_DELETED'; actorId: number; opportunityId: string }
  | {
      kind: 'COMMENT_CHANGED';
      actorId: number;
      opportunityId: string;
      /** Scoped to the opportunity's room, so a comment doesn't wake the whole board. */
      action: 'created' | 'updated' | 'deleted';
      commentId: string;
    }
  | {
      kind: 'ROADMAP_INVALIDATED';
      actorId: number;
      reason:
        | 'split'
        | 'merge'
        | 'goals'
        | 'owners'
        | 'views'
        | 'interviews'
        | 'releaseNotes';
    };
