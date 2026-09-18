import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { UserStatus } from 'src/user/constants/user-status.constants';
import { User } from 'src/user/entity/user.entity';
import { WaContact } from '../entity/wa-contact.entity';
import { WaIdentitySource } from '../enum/whatsapp.enum';
import {
  PHONE_MATCH_DIGITS,
  isSamePhone,
  phoneDigits,
  phoneKey,
} from '../util/phone';
import { WhatsAppPhoneMappingService } from './whatsapp-phone-mapping.service';

/** Every match candidate is checked in JS as well, and this many is already an ambiguity. */
const MAX_CANDIDATES = 5;

export interface ResolvedIdentity {
  userId: number;
  tenantId: string;
}

/**
 * Works out which organisation a WhatsApp number belongs to.
 *
 * The corpus is no longer global — a document can be targeted at particular organisations — so
 * before the bot can answer anything it has to know who is asking. The only identifier WhatsApp
 * gives us is a phone number, so this matches it against `users.phone`.
 *
 * THE RULE IS ALL-OR-NOTHING. Exactly one active user must match; zero matches and two matches
 * are both treated as unresolved, and an unresolved contact is told its number is not recognised
 * rather than answered from the global corpus. Picking one of two candidates would answer a
 * worker out of a stranger's organisation, and falling back to the global corpus would mean the
 * same question gets a different answer depending on whether we happened to recognise the sender
 * — with nothing anywhere to indicate which had happened.
 */
@Injectable()
export class WhatsAppIdentityService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppIdentityService.name,
  );

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(WaContact)
    private readonly contactRepository: Repository<WaContact>,
    private readonly mappingService: WhatsAppPhoneMappingService,
  ) {}

  /**
   * Resolve a number to a user and organisation, or null.
   *
   * Matched on the last {@link PHONE_MATCH_DIGITS} digits in SQL, then re-checked in JS: the
   * suffix is what makes differently-formatted numbers comparable, and the second check makes
   * sure the shorter of the two really is a tail of the longer rather than merely ending the
   * same way.
   *
   * The SQL is a scan over `users.phone` (a function of the column cannot use its index). That is
   * accepted rather than optimised: this runs once per inbound WhatsApp message, a path already
   * rate-limited to single-digit messages per minute per number, and the alternative — a stored
   * normalised column — is a migration plus a write path to keep it in step, for a query that is
   * not on any user-facing critical path.
   */
  async resolveByPhone(phoneE164: string): Promise<ResolvedIdentity | null> {
    const digits = phoneDigits(phoneE164);
    const suffix = phoneKey(digits);
    if (!suffix) return null;

    const candidates = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.tenantId', 'user.phone'])
      .where('user.phone IS NOT NULL')
      .andWhere("user.phone <> ''")
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .andWhere(
        `RIGHT(REGEXP_REPLACE(user.phone, '[^0-9]', '', 'g'), :len) = :suffix`,
        { len: PHONE_MATCH_DIGITS, suffix },
      )
      .limit(MAX_CANDIDATES)
      .getMany();

    // SQL matched on the key; `isSamePhone` is the check that then rejects the near-miss —
    // '449876543210' is not '919876543210' even though both end in the same ten digits.
    const matches = candidates.filter((user) =>
      isSamePhone(user.phone, digits),
    );

    if (matches.length !== 1) {
      if (matches.length > 1) {
        // Logged loudly and WITHOUT the number: two profiles carrying the same phone is a data
        // problem someone has to fix, and it is invisible until a worker reports that the bot
        // does not recognise them.
        this.logger.warn(
          `Ambiguous WhatsApp identity: ${matches.length} active users share the last ` +
            `${PHONE_MATCH_DIGITS} digits of an inbound number (user ids ` +
            `${matches.map((m) => m.id).join(', ')}). Treated as unrecognised.`,
        );
      }
      return null;
    }

    const [user] = matches;
    if (!user.tenantId) return null;

    return { userId: user.id, tenantId: user.tenantId };
  }

  /**
   * Resolve and persist, returning the contact as it now stands.
   *
   * TWO SOURCES, IN THIS ORDER. An admin's mapping (`wa_phone_mappings`) is checked first and a
   * `users.phone` match second, because the first is a deliberate statement made for this
   * purpose while the second is incidental — a profile field that may hold an old handset, or a
   * personal number on a work account. Where they disagree the mapping wins, and the
   * disagreement is shown in the mapping table rather than resolved out of sight.
   *
   * Runs on EVERY inbound message rather than only on first contact, so a number mapped (or
   * added to a profile) after someone first messaged starts working on their next question
   * instead of needing a support ticket. The write only happens when something actually
   * changed, so an already-linked contact costs two cheap reads.
   */
  async identify(contact: WaContact): Promise<WaContact> {
    const mapped = await this.mappingService.resolve(contact.phoneE164);
    // The mapping's own `userId` is a snapshot for attribution and may be null — a mapped
    // number often belongs to someone with no Ally account at all, which is the case mappings
    // exist for. The organisation is what matters and it comes from the mapping.
    const resolved = mapped
      ? { userId: mapped.userId ?? null, tenantId: mapped.tenantId }
      : await this.resolveByPhone(contact.phoneE164);
    const nextSource = mapped
      ? WaIdentitySource.MAPPING
      : WaIdentitySource.PHONE;

    const nextUserId = resolved?.userId ?? null;
    const nextTenantId = resolved?.tenantId ?? null;

    // Normalised before comparing: a contact row just created by `resolveContact` has these
    // fields ABSENT rather than null, and `undefined === null` is false — so without this a
    // brand-new number would write null over null on its first message every time.
    const currentUserId = contact.userId ?? null;
    const currentTenantId = contact.tenantId ?? null;

    if (
      currentUserId === nextUserId &&
      currentTenantId === nextTenantId &&
      // Compared too, so a number that used to resolve through a profile and is now covered by
      // an explicit mapping has that recorded — the ids can be identical while WHY they are set
      // has changed, and that is the difference between "we derived this" and "someone said so".
      (nextTenantId === null || contact.identitySource === nextSource) &&
      // A contact that has never been resolved has a null identifiedAt even when both ids
      // already match (both null), so the no-change path below must not treat "still
      // unrecognised" as needing a write.
      (nextTenantId === null || contact.identifiedAt != null)
    ) {
      return contact;
    }

    await this.contactRepository.update(
      { id: contact.id },
      {
        userId: nextUserId,
        tenantId: nextTenantId,
        identifiedAt: resolved ? new Date() : null,
        identitySource: resolved ? nextSource : null,
      },
    );

    if (resolved) {
      this.logger.info(
        `WhatsApp contact ending ${contact.phoneLast4} linked to organisation ` +
          `${resolved.tenantId} via ${nextSource}` +
          (resolved.userId ? ` (user ${resolved.userId})` : ''),
      );
    } else if (currentTenantId) {
      // A link that USED to resolve and now does not — a mapping was removed, the number was
      // cleared off the profile, or the account was suspended. Worth a line, because from the
      // worker's side the bot simply stops recognising them.
      this.logger.warn(
        `WhatsApp contact ending ${contact.phoneLast4} no longer resolves to an active user; ` +
          `its organisation link has been cleared`,
      );
    }

    return {
      ...contact,
      userId: nextUserId,
      tenantId: nextTenantId,
      identifiedAt: resolved ? new Date() : null,
      identitySource: resolved ? nextSource : null,
    } as WaContact;
  }
}
