import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { UserStatus } from 'src/user/constants/user-status.constants';
import { User } from 'src/user/entity/user.entity';
import {
  BulkWaPhoneMappingResultDto,
  BulkWaPhoneMappingsDto,
  BulkWaPhoneMappingsResponseDto,
  CreateWaPhoneMappingDto,
  GetWaPhoneMappingsQueryDto,
  UpdateWaPhoneMappingDto,
  WaPhoneMappingOutcome,
  WaPhoneMappingResponseDto,
} from '../dto/whatsapp-phone-mapping.dto';
import { WaPhoneMapping } from '../entity/wa-phone-mapping.entity';
import { PHONE_MATCH_DIGITS, phoneDigits, phoneKey } from '../util/phone';

/**
 * Phone → organisation mappings: the admin's answer to "the bot does not recognise this number".
 *
 * The corpus is targeted per organisation, so a sender whose organisation cannot be resolved is
 * refused. Resolution has two sources — a number on somebody's Ally profile, or a mapping here —
 * and this is the only one an admin can actually create in the product.
 */
@Injectable()
export class WhatsAppPhoneMappingService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppPhoneMappingService.name,
  );

  constructor(
    @InjectRepository(WaPhoneMapping)
    private readonly mappingRepository: Repository<WaPhoneMapping>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private currentUserId(): number {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('unauthorized access');
    return Number(userId);
  }

  /**
   * Active users whose number matches any of these keys, keyed BY key.
   *
   * One scan for a whole batch rather than one per row: the key is a function of the column so
   * no index can serve it, and a thousand-row upload doing a thousand scans would be minutes.
   *
   * A key with more than one matching user is dropped from the map entirely — the same
   * all-or-nothing rule the identity resolver applies. Attributing a mapping to one of two
   * candidate accounts would put a name against it that may be the wrong person's.
   */
  private async usersByPhoneKey(
    keys: string[],
  ): Promise<Map<string, { id: number; tenantId: string }>> {
    const byKey = new Map<string, { id: number; tenantId: string }>();
    const unique = [...new Set(keys.filter(Boolean))];
    if (!unique.length) return byKey;

    const rows = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.tenantId', 'user.phone'])
      .where('user.phone IS NOT NULL')
      .andWhere("user.phone <> ''")
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .andWhere(
        `RIGHT(REGEXP_REPLACE(user.phone, '[^0-9]', '', 'g'), :len) IN (:...keys)`,
        { len: PHONE_MATCH_DIGITS, keys: unique },
      )
      .getMany();

    const ambiguous = new Set<string>();
    for (const row of rows) {
      const key = phoneKey(row.phone);
      if (!key) continue;
      if (byKey.has(key)) {
        ambiguous.add(key);
        continue;
      }
      byKey.set(key, { id: row.id, tenantId: row.tenantId });
    }
    for (const key of ambiguous) byKey.delete(key);

    return byKey;
  }

  private async tenantNames(tenantIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(tenantIds.filter(Boolean))];
    if (!unique.length) return new Map();
    const tenants = await this.tenantRepository.find({
      where: { id: In(unique) },
      select: ['id', 'name'],
    });
    return new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const found = await this.tenantRepository.count({
      where: { id: tenantId },
    });
    if (!found) {
      throw new BadRequestException(
        'That organisation no longer exists. Reload the page and pick again.',
      );
    }
  }

  async list(
    dto: GetWaPhoneMappingsQueryDto,
  ): Promise<{ mappings: WaPhoneMappingResponseDto[]; count: number }> {
    const query = this.mappingRepository
      .createQueryBuilder('m')
      .where('m.deletedAt IS NULL');

    if (dto.tenantId) {
      query.andWhere('m.tenantId = :tenantId', { tenantId: dto.tenantId });
    }
    if (dto.search?.trim()) {
      // Digits of the search term against the stored digits, so a number typed with spaces or a
      // `+` still finds its row — the whole point of storing a normalised form.
      const digits = phoneDigits(dto.search);
      const term = `%${dto.search.trim().toLowerCase()}%`;
      if (digits) {
        query.andWhere(
          '(m.phoneE164 LIKE :digits OR LOWER(m.label) LIKE :term)',
          { digits: `%${digits}%`, term },
        );
      } else {
        query.andWhere('LOWER(m.label) LIKE :term', { term });
      }
    }

    const [rows, count] = await query
      .orderBy('m.createdAt', 'DESC')
      .limit(dto.limit ?? 25)
      .offset(dto.offset ?? 0)
      .getManyAndCount();

    // Both lookups are batched over the page, not per row.
    const [names, users] = await Promise.all([
      this.tenantNames(rows.map((row) => row.tenantId)),
      this.usersByPhoneKey(rows.map((row) => row.phoneKey)),
    ]);
    const conflictingTenantIds = rows
      .map((row) => users.get(row.phoneKey)?.tenantId)
      .filter((id): id is string => Boolean(id));
    const conflictNames = await this.tenantNames(conflictingTenantIds);

    return {
      mappings: rows.map((row) => {
        const user = users.get(row.phoneKey);
        const conflicts = Boolean(user && user.tenantId !== row.tenantId);
        return {
          id: row.id,
          phoneE164: row.phoneE164,
          tenantId: row.tenantId,
          tenantName: names.get(row.tenantId) ?? null,
          label: row.label ?? null,
          userId: row.userId ?? null,
          conflictingTenantName: conflicts
            ? (conflictNames.get(user!.tenantId) ?? null)
            : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
      count,
    };
  }

  /**
   * Add or move one number.
   *
   * An existing live mapping for the same handset is UPDATED rather than rejected: from the
   * admin's side "add this number to Acme" is the same intention whether or not they remember
   * mapping it to Beacon last year, and a 409 would leave them hunting for a row they cannot
   * search by a number they typed in a different format.
   */
  async create(
    dto: CreateWaPhoneMappingDto,
  ): Promise<WaPhoneMappingResponseDto> {
    const userId = this.currentUserId();
    const digits = phoneDigits(dto.phone);
    const key = phoneKey(dto.phone);

    if (!key) {
      throw new BadRequestException(
        `That number is too short to identify anyone — at least ${PHONE_MATCH_DIGITS} ` +
          `digits are needed.`,
      );
    }
    await this.assertTenantExists(dto.tenantId);

    const matchedUser = (await this.usersByPhoneKey([key])).get(key);
    const existing = await this.mappingRepository.findOne({
      where: { phoneKey: key, deletedAt: IsNull() },
    });

    if (existing) {
      await this.mappingRepository.update(
        { id: existing.id },
        {
          phoneE164: digits,
          tenantId: dto.tenantId,
          label: dto.label ?? existing.label ?? null,
          userId: matchedUser?.id ?? null,
          updatedBy: userId,
        },
      );
      this.logger.info(
        `WhatsApp phone mapping ${existing.id} moved to organisation ${dto.tenantId}`,
      );
      return this.get(existing.id);
    }

    const saved = await this.mappingRepository.save(
      this.mappingRepository.create({
        phoneE164: digits,
        phoneKey: key,
        tenantId: dto.tenantId,
        label: dto.label ?? null,
        userId: matchedUser?.id ?? null,
        createdBy: userId,
      }),
    );
    this.logger.info(
      `WhatsApp phone mapping created for organisation ${dto.tenantId}`,
    );
    return this.get(saved.id);
  }

  async get(id: string): Promise<WaPhoneMappingResponseDto> {
    const row = await this.mappingRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException(`Mapping ${id} was not found`);
    return this.toResponse(row);
  }

  /**
   * One row, with its organisation name and any conflict resolved.
   *
   * Shares the shape the list builds, so a mapping cannot render one way in the table and
   * another in the panel that edits it.
   */
  private async toResponse(
    row: WaPhoneMapping,
  ): Promise<WaPhoneMappingResponseDto> {
    const [names, users] = await Promise.all([
      this.tenantNames([row.tenantId]),
      this.usersByPhoneKey([row.phoneKey]),
    ]);
    const user = users.get(row.phoneKey);
    const conflicts = Boolean(user && user.tenantId !== row.tenantId);
    const conflictNames = conflicts
      ? await this.tenantNames([user!.tenantId])
      : new Map<string, string>();

    return {
      id: row.id,
      phoneE164: row.phoneE164,
      tenantId: row.tenantId,
      tenantName: names.get(row.tenantId) ?? null,
      label: row.label ?? null,
      userId: row.userId ?? null,
      conflictingTenantName: conflicts
        ? (conflictNames.get(user!.tenantId) ?? null)
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async update(
    id: string,
    dto: UpdateWaPhoneMappingDto,
  ): Promise<WaPhoneMappingResponseDto> {
    const row = await this.mappingRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException(`Mapping ${id} was not found`);
    if (dto.tenantId) await this.assertTenantExists(dto.tenantId);

    await this.mappingRepository.update(
      { id },
      {
        ...(dto.tenantId ? { tenantId: dto.tenantId } : {}),
        ...(dto.label !== undefined ? { label: dto.label || null } : {}),
        updatedBy: this.currentUserId(),
      },
    );
    return this.get(id);
  }

  /**
   * Remove a mapping. Soft, so the removal itself stays on the record.
   *
   * The number may still resolve afterwards through `users.phone` — removing the mapping undoes
   * the admin's statement, it does not blacklist the number.
   */
  async remove(id: string): Promise<{ id: string; removed: boolean }> {
    const row = await this.mappingRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException(`Mapping ${id} was not found`);

    await this.mappingRepository.update(
      { id },
      { updatedBy: this.currentUserId() },
    );
    await this.mappingRepository.softDelete({ id });
    this.logger.info(`WhatsApp phone mapping ${id} removed`);
    return { id, removed: true };
  }

  /**
   * Upload many at once, reporting what happened to every row.
   *
   * Deliberately NOT all-or-nothing (unlike POST /users/bulk): these rows are independent, so
   * one mistyped number in a pasted roster must not throw away the rest. The admin gets the
   * lines to fix instead of a rejected file with no detail.
   *
   * Duplicates WITHIN one upload are reported rather than resolved. Two rows for the same
   * handset naming different organisations is a mistake in the file, and picking whichever came
   * last would hide it — the admin fixes the file.
   */
  async bulkCreate(
    dto: BulkWaPhoneMappingsDto,
  ): Promise<BulkWaPhoneMappingsResponseDto> {
    const userId = this.currentUserId();
    const results: BulkWaPhoneMappingResultDto[] = [];

    const requestedTenantIds = [
      ...new Set(
        [dto.defaultTenantId, ...dto.rows.map((row) => row.tenantId)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const knownTenants = await this.tenantNames(requestedTenantIds);

    // Everything the batch needs, read up front: one users scan, one mappings read.
    const keys = dto.rows.map((row) => phoneKey(row.phone));
    const [users, existingRows] = await Promise.all([
      this.usersByPhoneKey(keys),
      this.mappingRepository.find({
        where: { phoneKey: In(keys.filter(Boolean)), deletedAt: IsNull() },
      }),
    ]);
    const existing = new Map(existingRows.map((row) => [row.phoneKey, row]));
    const seen = new Map<string, number>();

    const toInsert: WaPhoneMapping[] = [];
    const counts: Record<WaPhoneMappingOutcome, number> = {
      created: 0,
      updated: 0,
      unchanged: 0,
      conflict: 0,
      invalid: 0,
      duplicate: 0,
    };

    const record = (
      line: number,
      phone: string,
      outcome: WaPhoneMappingOutcome,
      reason: string | null = null,
    ) => {
      counts[outcome] += 1;
      results.push({ line, phone, outcome, reason });
    };

    for (let index = 0; index < dto.rows.length; index++) {
      const row = dto.rows[index];
      const line = index + 1;
      const key = phoneKey(row.phone);
      const digits = phoneDigits(row.phone);

      if (!key) {
        record(
          line,
          row.phone,
          'invalid',
          `Needs at least ${PHONE_MATCH_DIGITS} digits`,
        );
        continue;
      }

      const firstSeenAt = seen.get(key);
      if (firstSeenAt) {
        record(
          line,
          row.phone,
          'duplicate',
          `Same number as line ${firstSeenAt}`,
        );
        continue;
      }
      seen.set(key, line);

      const tenantId = row.tenantId ?? dto.defaultTenantId;
      if (!tenantId) {
        record(line, row.phone, 'invalid', 'No organisation for this row');
        continue;
      }
      if (!knownTenants.has(tenantId)) {
        record(line, row.phone, 'invalid', 'That organisation does not exist');
        continue;
      }

      const current = existing.get(key);
      if (current) {
        if (current.tenantId === tenantId) {
          record(line, row.phone, 'unchanged', 'Already mapped here');
          continue;
        }
        if (!dto.overwriteConflicts) {
          record(
            line,
            row.phone,
            'conflict',
            `Already mapped to ${knownTenants.get(current.tenantId) ?? 'another organisation'}`,
          );
          continue;
        }
        await this.mappingRepository.update(
          { id: current.id },
          {
            phoneE164: digits,
            tenantId,
            label: row.label ?? current.label ?? null,
            userId: users.get(key)?.id ?? null,
            updatedBy: userId,
          },
        );
        record(line, row.phone, 'updated');
        continue;
      }

      toInsert.push(
        this.mappingRepository.create({
          phoneE164: digits,
          phoneKey: key,
          tenantId,
          label: row.label ?? null,
          userId: users.get(key)?.id ?? null,
          createdBy: userId,
        }),
      );
      record(line, row.phone, 'created');
    }

    // Chunked, for the same reason the chunk writer is: one insert of a thousand rows can
    // exceed the driver's parameter limit.
    for (let i = 0; i < toInsert.length; i += 200) {
      await this.mappingRepository.save(toInsert.slice(i, i + 200));
    }

    this.logger.info(
      `Bulk phone mappings: ${counts.created} created, ${counts.updated} updated, ` +
        `${counts.conflict} conflict(s), ${counts.invalid} invalid, ` +
        `${counts.duplicate} duplicate(s)`,
    );

    return {
      created: counts.created,
      updated: counts.updated,
      unchanged: counts.unchanged,
      conflicts: counts.conflict,
      invalid: counts.invalid,
      duplicates: counts.duplicate,
      results,
    };
  }

  /**
   * The resolver's entry point: which organisation, if any, has claimed this number.
   *
   * Keyed lookup on the unique index — no scan — so it is cheap enough to sit in front of the
   * `users.phone` match on every inbound message.
   */
  async resolve(
    phone: string,
  ): Promise<{ tenantId: string; userId: number | null } | null> {
    const key = phoneKey(phone);
    if (!key) return null;

    const row = await this.mappingRepository.findOne({
      where: { phoneKey: key, deletedAt: IsNull() },
    });
    if (!row) return null;

    return { tenantId: row.tenantId, userId: row.userId ?? null };
  }
}
