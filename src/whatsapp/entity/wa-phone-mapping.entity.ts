import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One phone number an admin has assigned to an organisation.
 *
 * The corpus is targeted per organisation, so the bot has to know which organisation a WhatsApp
 * sender belongs to before it can answer anything. It works that out from the number, and there
 * are only two ways to know: the number is on somebody's Ally profile (`users.phone`), or an
 * admin said so. This table is the second one, and it is the only one an admin can actually
 * perform in the product.
 *
 * IT DELIBERATELY DOES NOT REQUIRE AN ACCOUNT. Most people this bot serves are frontline workers
 * who may never log into Ally at all; a mapping table that could only name existing users would
 * leave exactly those people permanently unrecognised, which is the case it exists to fix.
 * `userId` is therefore optional and only for attribution.
 *
 * A mapping WINS over a `users.phone` match. It was typed by a person for this purpose, where
 * the profile field is incidental and often stale (an old handset, a personal number on a work
 * profile). The disagreement is surfaced in the admin table rather than resolved silently, so
 * "this number maps to Acme but its owner's profile says Beacon" is visible.
 *
 * Soft-deleted, like `kb_document_tenants`: the conversation log keeps citations, so a question
 * about why a worker was once answered from a particular organisation's material is only
 * answerable if the removal left a trace.
 */
@Entity('wa_phone_mappings')
export class WaPhoneMapping extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The number as it will be compared to an inbound message: digits only, no `+`.
   *
   * Stored alongside `phoneKey` rather than derived from it because the full number is what an
   * admin recognises in the table, and because the key alone cannot tell `+91 98765 43210` from
   * a different country's number ending the same way.
   */
  @Column({ type: 'varchar', length: 32, name: 'phone_e164' })
  phoneE164!: string;

  /**
   * The last ten digits — the lookup key, and the uniqueness rule. See util/phone.ts.
   *
   * UNIQUE among live rows, because one number resolving to two organisations is exactly the
   * ambiguity the identity rule refuses to guess through. A second mapping for the same handset
   * has to replace the first, deliberately, rather than sit beside it.
   */
  @Index('uq_wa_phone_mappings_key', ['phoneKey'], {
    unique: true,
    where: '"deletedAt" IS NULL',
  })
  @Column({ type: 'varchar', length: 16, name: 'phone_key' })
  phoneKey!: string;

  /** The organisation whose documents this number may be answered from. */
  @Index('idx_wa_phone_mappings_tenant')
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId!: string;

  /**
   * Who this number belongs to, in the admin's words — a name, a role, a ward.
   *
   * Free text and optional, and the table's only human handle: a list of 200 bare numbers is
   * unauditable, and the person who has to remove one in six months is not the person who
   * uploaded it.
   */
  @Column({ type: 'text', nullable: true })
  label?: string | null;

  /**
   * The Ally user this number turned out to belong to, when one matched at write time.
   *
   * Recorded for attribution only — the organisation comes from `tenantId`, never from this. It
   * is a snapshot, not a live link: a user who later changes their number does not silently
   * change what this mapping grants.
   */
  @Column({ type: 'int', name: 'user_id', nullable: true })
  userId?: number | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;

  @DeleteDateColumn()
  deletedAt?: Date;
}
