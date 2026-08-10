import { Module } from '@nestjs/common';
import { RoleplaySessionLogsController } from './controller/roleplay-session-logs.controller';
import { RoleplaySessionLogsService } from './service/roleplay-session-logs.service';
import { RoleplaySessionLogsRepository } from './repository/roleplay-session-logs.repository';
import { AwsModule } from '../aws/aws.module';
import { LanguageModule } from '../language/language.module';

/**
 * Super-admin "Roleplay Session Logs" — a platform-wide (cross-tenant) read-only
 * view over `scenario_sessions`. The `@AuthRoles(SUPER_ADMIN)` guard resolves
 * its deps (JWT strategy + PermissionsService) from the globally-scoped
 * AuthModule / AuthorizationModule, so no imports are required here. The
 * repository talks to the shared `DataSource` directly (cross-tenant), so no
 * TypeOrmModule.forFeature registration is needed either. AwsModule provides
 * S3Service for presigning recording playback URLs; LanguageModule provides
 * GlossaryAdherenceService for the session detail's read-only glossary card.
 */
@Module({
  imports: [AwsModule, LanguageModule],
  controllers: [RoleplaySessionLogsController],
  providers: [RoleplaySessionLogsService, RoleplaySessionLogsRepository],
})
export class RoleplaySessionLogsModule {}
