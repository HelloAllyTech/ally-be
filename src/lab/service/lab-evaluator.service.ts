import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { AppConfigService } from 'src/config/config.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';
import { EmailService } from 'src/notification/service/email.service';
import { LabEvaluatorRepository } from '../repository/lab-evaluator.repository';
import { LabRunAssignmentRepository } from '../repository/lab-eval.repositories';
import { LabEvaluator } from '../entity/lab-evaluator.entity';
import { CreateLabEvaluatorDto, EvaluatorLoginDto } from '../dto/lab-eval.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';
import {
  EVALUATOR_PASSWORD_CHARSET,
  EVALUATOR_PASSWORD_LENGTH,
  EVALUATOR_PASSWORD_SALT_ROUNDS,
  EVALUATOR_TOKEN_EXPIRES_IN,
  EVALUATOR_TOKEN_KIND,
} from '../constants/lab-eval.constants';

// A bcrypt hash of a throwaway value, computed once at startup (not a
// hardcoded literal, so no secret is committed). When login is attempted for
// an unknown email we compare against this so the known- and unknown-email
// paths pay the same bcrypt cost — closing the timing side channel that would
// otherwise let an attacker enumerate which emails are evaluator accounts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'lab-evaluator-timing-equalizer',
  EVALUATOR_PASSWORD_SALT_ROUNDS,
);

/** Public (hash-free) shape returned to admins and to the evaluator app. */
export interface LabEvaluatorResponse {
  id: string;
  email: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  assignedCount?: number;
  submittedCount?: number;
}

@Injectable()
export class LabEvaluatorService {
  private readonly logger = LoggerService.getInstance(LabEvaluatorService.name);

  constructor(
    private readonly evaluatorRepository: LabEvaluatorRepository,
    private readonly assignmentRepository: LabRunAssignmentRepository,
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Email the evaluator their portal link + credentials (best-effort).
   *
   * This try/catch was structurally dead: `SESService.sendEmail` returned `false`
   * on every failure and never threw, so an evaluator whose invite bounced was
   * created with a password nobody ever received, and the admin saw a clean
   * success. The send now throws, which makes this catch live — and the alert
   * that goes with it comes from SESService, so the failure is visible even
   * though it is still deliberately non-fatal (the evaluator row is valid and
   * the invite can be resent).
   */
  private async sendInvite(email: string, password: string): Promise<void> {
    try {
      await this.emailService.sendEvaluatorInvite({ to: email, password });
    } catch (error) {
      this.logger.error(
        `[AI_LAB] failed to send evaluator invite to ${email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** NEVER expose passwordHash/tokenVersion outside this service. */
  private toResponse(evaluator: LabEvaluator): LabEvaluatorResponse {
    return {
      id: evaluator.id,
      email: evaluator.email,
      lastLoginAt: evaluator.lastLoginAt ?? null,
      createdAt: evaluator.createdAt,
    };
  }

  private generatePassword(): string {
    let password = '';
    for (let i = 0; i < EVALUATOR_PASSWORD_LENGTH; i++) {
      password +=
        EVALUATOR_PASSWORD_CHARSET[
          randomInt(EVALUATOR_PASSWORD_CHARSET.length)
        ];
    }
    return password;
  }

  async list(
    query: LabListQueryDto,
  ): Promise<{ items: LabEvaluatorResponse[]; count: number }> {
    const { items, count } = await this.evaluatorRepository.list({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    // Per-evaluator assignment stats for the admin table.
    const ids = items.map((e) => e.id);
    const stats = new Map<string, { assigned: number; submitted: number }>();
    if (ids.length > 0) {
      const rows: {
        evaluator_id: string;
        assigned: string;
        submitted: string;
      }[] = await this.assignmentRepository
        .createQueryBuilder('assignment')
        .select('assignment.evaluatorId', 'evaluator_id')
        .addSelect('COUNT(*)', 'assigned')
        .addSelect(
          'COUNT(*) FILTER (WHERE assignment.submitted_at IS NOT NULL)',
          'submitted',
        )
        .where('assignment.evaluatorId IN (:...ids)', { ids })
        .groupBy('assignment.evaluatorId')
        .getRawMany();
      for (const row of rows) {
        stats.set(row.evaluator_id, {
          assigned: Number(row.assigned),
          submitted: Number(row.submitted),
        });
      }
    }

    return {
      items: items.map((evaluator) => ({
        ...this.toResponse(evaluator),
        assignedCount: stats.get(evaluator.id)?.assigned ?? 0,
        submittedCount: stats.get(evaluator.id)?.submitted ?? 0,
      })),
      count,
    };
  }

  /**
   * Create an evaluator with an auto-generated password. The plaintext is
   * returned ONCE for the admin to copy/share offline; only the bcrypt hash
   * is stored.
   */
  async create(
    dto: CreateLabEvaluatorDto,
  ): Promise<{ evaluator: LabEvaluatorResponse; password: string }> {
    const email = dto.email.trim().toLowerCase();
    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(
      password,
      EVALUATOR_PASSWORD_SALT_ROUNDS,
    );
    const userId = Number(ExecutionManager.getUserId() ?? 0);

    try {
      const saved = await this.evaluatorRepository.save(
        this.evaluatorRepository.create({
          email,
          passwordHash,
          createdBy: userId,
        }),
      );
      this.logger.info(`[AI_LAB] evaluator created: ${saved.id}`);
      await this.sendInvite(saved.email, password);
      return { evaluator: this.toResponse(saved), password };
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `An evaluator with email '${email}' already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Regenerate the evaluator's password. Bumps tokenVersion so any tokens
   * minted with the old password stop working immediately. Plaintext returned
   * once for offline sharing.
   */
  async regeneratePassword(id: string): Promise<{ password: string }> {
    const evaluator = await this.evaluatorRepository.findOne({ where: { id } });
    if (!evaluator) {
      throw new NotFoundException(`Evaluator with ID ${id} not found`);
    }
    const password = this.generatePassword();
    evaluator.passwordHash = await bcrypt.hash(
      password,
      EVALUATOR_PASSWORD_SALT_ROUNDS,
    );
    evaluator.tokenVersion += 1;
    await this.evaluatorRepository.save(evaluator);
    this.logger.info(`[AI_LAB] evaluator password regenerated: ${id}`);
    await this.sendInvite(evaluator.email, password);
    return { password };
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const evaluator = await this.evaluatorRepository.findOne({ where: { id } });
    if (!evaluator) {
      throw new NotFoundException(`Evaluator with ID ${id} not found`);
    }
    // FK cascade removes their assignments and answers.
    await this.evaluatorRepository.delete(id);
    this.logger.info(`[AI_LAB] evaluator deleted: ${id}`);
    return { success: true };
  }

  /**
   * Email + password login for the /evaluate micro-app. Issues a JWT with a
   * dedicated `kind` claim (so it can never pass as a platform-user token)
   * and the current tokenVersion (so password regeneration revokes it).
   */
  async login(dto: EvaluatorLoginDto): Promise<{
    accessToken: string;
    evaluator: LabEvaluatorResponse;
  }> {
    const email = dto.email.trim().toLowerCase();
    const evaluator = await this.evaluatorRepository.findOne({
      where: { email },
    });
    // Same error AND same cost for unknown email vs. wrong password: always run
    // one bcrypt.compare (against a dummy hash when the email is unknown) so the
    // two paths are indistinguishable by response time (no user enumeration).
    const valid = await bcrypt.compare(
      dto.password,
      evaluator?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!evaluator || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    evaluator.lastLoginAt = new Date();
    await this.evaluatorRepository.save(evaluator);

    const accessToken = await this.jwtService.signAsync(
      {
        sub: evaluator.id,
        email: evaluator.email,
        kind: EVALUATOR_TOKEN_KIND,
        tv: evaluator.tokenVersion,
      },
      {
        secret: this.configService.jwt.accessToken.secret,
        expiresIn: EVALUATOR_TOKEN_EXPIRES_IN,
      },
    );

    this.logger.info(`[AI_LAB] evaluator login: ${evaluator.id}`);
    return { accessToken, evaluator: this.toResponse(evaluator) };
  }

  /** Used by the evaluator guard on every portal request. */
  async validateToken(payload: {
    sub?: string;
    kind?: string;
    tv?: number;
  }): Promise<LabEvaluator> {
    if (payload.kind !== EVALUATOR_TOKEN_KIND || !payload.sub) {
      throw new UnauthorizedException();
    }
    const evaluator = await this.evaluatorRepository.findOne({
      where: { id: payload.sub },
    });
    if (!evaluator || evaluator.tokenVersion !== (payload.tv ?? -1)) {
      throw new UnauthorizedException();
    }
    return evaluator;
  }
}
