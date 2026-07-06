import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { ScenarioVoices } from 'src/learn/entity/scenario-voices.entity';
import { DEFAULT_SCENARIO_SESSION_TTL_SECONDS } from 'src/learn/constants/scenario-session.constants';
import { RoleplaySpecService } from './roleplay-spec.service';
import { SpecCompilerService } from './spec-compiler.service';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';
import { RoleplaySpecVersion } from '../entity/roleplay-spec-version.entity';
import { RoleplayDirectorEventRepository } from '../repository/roleplay-director-event.repository';
import { RoleplayRubricScoreRepository } from '../repository/roleplay-rubric-score.repository';
import { StartRoleplaySessionDto } from '../dto/roleplay-session.dto';
import { ROLEPLAY_ROOM_ID_PREFIX } from '../constants/roleplay-studio.constants';

/**
 * ROLEPLAY_V2 session runtime: creates the scenario_sessions row (roomId
 * `roleplay-<uuid>`), builds the FROZEN room-metadata contract, creates the
 * LiveKit room and dispatches the dedicated roleplay agent
 * (config.livekit.roleplayAgentName).
 *
 * Room metadata contract (consumed by the v2 agent):
 *   { engine: 'roleplay_v2', specSchemaVersion, spec: <compiled|null>,
 *     specFetch: { versionId, url } | null,
 *     session: { scenarioSessionId, specId, specVersionId, userId },
 *     language, voice }
 * The compiled spec is inlined when its serialization is under 55KB;
 * otherwise `specFetch` points at the api-key-guarded spec-version webhook.
 */
@Injectable()
export class RoleplaySessionService {
  private readonly logger = LoggerService.getInstance(
    RoleplaySessionService.name,
  );

  constructor(
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly specCompiler: SpecCompilerService,
    private readonly directorEventRepository: RoleplayDirectorEventRepository,
    private readonly rubricScoreRepository: RoleplayRubricScoreRepository,
    private readonly livekitService: LiveKitService,
    private readonly configService: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /** Entry point used by both the studio controller and the v1 engine branch. */
  async startSpecSession(
    userId: number,
    specId: string,
    specVersionId: string | null,
    dto: StartRoleplaySessionDto = {},
  ) {
    const spec = await this.roleplaySpecService.getSpec(specId);
    const version = await this.resolveVersion(spec, specVersionId);
    const document = version.spec;

    const languageId = dto.languageId ?? document.language?.languageId;
    if (!languageId) {
      throw new BadRequestException(
        'No languageId provided and the spec has no default language',
      );
    }
    const voiceId = document.voice?.languageVoices?.[String(languageId)];
    if (!voiceId) {
      throw new BadRequestException(
        `Spec has no voice configured for language ${languageId}`,
      );
    }
    const voice = await this.dataSource
      .getRepository(ScenarioVoices)
      .findOne({ where: { id: voiceId } });
    if (!voice || !voice.active) {
      throw new BadRequestException('Voice not found or inactive');
    }

    const languageBlock = {
      languageId,
      languageCode:
        languageId === document.language?.languageId
          ? (document.language?.languageCode ?? null)
          : null,
    };

    const scenarioSession = await this.createSessionRow(
      userId,
      spec,
      version,
      languageId,
      voiceId,
    );

    try {
      const roomMetadata = this.buildRoomMetadata({
        document,
        version,
        spec,
        scenarioSession,
        userId,
        language: languageBlock,
        voice,
      });

      await this.livekitService.createRoom({
        name: scenarioSession.roomId,
        ttl: dto.ttl ?? DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
        metadata: roomMetadata,
      });

      // Pre-mark BEFORE dispatch so the participant_joined fallback (which
      // would dispatch the v1 agent) never fires for this room, then dispatch
      // the v2 agent synchronously — a failed dispatch must fail the start,
      // not fall back to the wrong engine.
      this.livekitService.preMarkProactiveDispatch(scenarioSession.roomId);
      try {
        await this.livekitService.agentDispatch(
          scenarioSession.roomId,
          this.configService.livekit.roleplayAgentName,
          JSON.stringify(roomMetadata),
        );
      } catch (error) {
        this.livekitService.clearProactiveDispatch(scenarioSession.roomId);
        throw error;
      }

      const accessToken = await this.livekitService.generateAccessToken({
        roomName: scenarioSession.roomId,
        participantName: userId.toString(),
      });

      return {
        scenarioSession,
        accessToken,
        spec: {
          id: spec.id,
          specVersionId: version.id,
          title: document.title ?? spec.title,
          difficulty: document.difficulty,
          openingStatement: document.openingStatement,
        },
      };
    } catch (error) {
      // Mirror v1: a failed room/dispatch leaves no orphan session row.
      await this.dataSource
        .getRepository(ScenarioSessions)
        .delete(scenarioSession.id);
      throw error;
    }
  }

  /**
   * Runtime payload for a version — served inline in room metadata or via the
   * api-key-guarded webhook (GET /v1/roleplay-studio/webhook/spec-versions/:id).
   */
  async getCompiledSpecVersion(versionId: string) {
    const version = await this.roleplaySpecService.getVersionById(versionId);
    const compiled = this.specCompiler.compile(version.spec);
    return {
      versionId: version.id,
      specId: version.specId,
      specSchemaVersion: version.spec.specSchemaVersion ?? null,
      spec: compiled,
    };
  }

  async getDirectorEvents(scenarioSessionId: string) {
    await this.requireSession(scenarioSessionId);
    return this.directorEventRepository.listBySession(scenarioSessionId);
  }

  async getRubricScores(scenarioSessionId: string) {
    await this.requireSession(scenarioSessionId);
    return this.rubricScoreRepository.listBySession(scenarioSessionId);
  }

  // ------------------------------------------------------------- internals

  private async resolveVersion(
    spec: RoleplaySpec,
    specVersionId: string | null,
  ): Promise<RoleplaySpecVersion> {
    // Explicit version wins (studio test runs); otherwise the published one
    // (learner path via the engine branch).
    const versionId = specVersionId ?? spec.publishedVersionId;
    if (!versionId) {
      throw new BadRequestException(
        'Spec has no published version; publish one or pass a versionId',
      );
    }
    const version = await this.roleplaySpecService.getVersion(
      spec.id,
      versionId,
    );
    return version;
  }

  private async createSessionRow(
    userId: number,
    spec: RoleplaySpec,
    version: RoleplaySpecVersion,
    languageId: number,
    voiceId: string,
  ): Promise<ScenarioSessions> {
    const repo = this.dataSource.getRepository(ScenarioSessions);
    const id = uuidv4();
    const session = await repo.save(
      repo.create({
        id,
        roomId: `${ROLEPLAY_ROOM_ID_PREFIX}${id}`,
        scenarioId: spec.scenarioId,
        counselorId: userId,
        tenantId: ExecutionManager.getTenantId(),
        metadata: {
          engine: 'roleplay_v2',
          languageId,
          voiceId,
          roleplaySpecId: spec.id,
          roleplaySpecVersionId: version.id,
        },
      }),
    );
    // roleplaySpecVersionId exists only as a DB column (the v1 entity stays
    // untouched), so it is written with a raw UPDATE.
    await this.dataSource.query(
      `UPDATE "scenario_sessions" SET "roleplaySpecVersionId" = $1 WHERE id = $2`,
      [version.id, session.id],
    );
    return session;
  }

  private buildRoomMetadata(options: {
    document: RoleplaySpecVersion['spec'];
    version: RoleplaySpecVersion;
    spec: RoleplaySpec;
    scenarioSession: ScenarioSessions;
    userId: number;
    language: Record<string, any>;
    voice: ScenarioVoices;
  }): Record<string, any> {
    const {
      document,
      version,
      spec,
      scenarioSession,
      userId,
      language,
      voice,
    } = options;
    const { compiled, inline, sizeBytes } =
      this.specCompiler.compileWithInfo(document);
    if (!inline) {
      this.logger.info(
        `Compiled spec for version ${version.id} is ${sizeBytes}B — using specFetch`,
      );
    }
    const baseUrl = (this.configService.api.baseUrl ?? '').replace(/\/$/, '');
    return {
      engine: 'roleplay_v2',
      specSchemaVersion: document.specSchemaVersion ?? null,
      spec: inline ? compiled : null,
      specFetch: inline
        ? null
        : {
            versionId: version.id,
            url: `${baseUrl}/v1/roleplay-studio/webhook/spec-versions/${version.id}`,
          },
      session: {
        scenarioSessionId: scenarioSession.id,
        specId: spec.id,
        specVersionId: version.id,
        userId,
      },
      language,
      voice: {
        id: voice.id,
        name: voice.name,
        provider: voice.provider,
        config: voice.config ?? null,
      },
    };
  }

  private async requireSession(scenarioSessionId: string): Promise<void> {
    const session = await this.dataSource
      .getRepository(ScenarioSessions)
      .findOne({ where: { id: scenarioSessionId } });
    if (!session) {
      throw new NotFoundException('Scenario session not found');
    }
  }
}
