import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Full room-metadata envelope for a LiveKit room, stored at session/preview
 * start and served to the voice agent via the api-key-guarded webhook
 * (GET /v1/learn/webhook/room-metadata/:roomName).
 *
 * Exists so LiveKit room + dispatch metadata can stay tiny (a fetch pointer):
 * the full envelope (~180KB with translations/glossary) rode inside every
 * agent availability request and blew LiveKit's 3s dispatch window over the
 * high-RTT server↔worker link. Rows are short-lived working data — one per
 * room, swept after ROOM_METADATA_STALE_HOURS (rooms live minutes to hours).
 *
 * No tenant column: the envelope already carries tenantId, and the reader is
 * a machine-to-machine webhook with no tenant context.
 */
@Entity('learn_room_metadata')
@Index('IDX_learn_room_metadata_created_at', ['createdAt'])
export class LearnRoomMetadata extends BaseWithoutTenantEntity {
  /** LiveKit room name (`ss_<sessionId>` or `preview-<scenarioId>-<uuid>`). */
  @PrimaryColumn({ type: 'varchar', length: 255 })
  roomName!: string;

  /** The exact envelope createRoomMetadata built (version/tenantId/environment/scenario). */
  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;
}
