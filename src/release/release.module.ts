import { Module } from '@nestjs/common';
import { GithubModule } from 'src/github/github.module';
import { ProductionReleaseService } from './service/production-release.service';

/**
 * Production releases, shared by every feature that ships one.
 *
 * Exports the service only; the target table is a plain constant, imported
 * directly wherever a caller needs to name a deployable.
 */
@Module({
  imports: [GithubModule],
  providers: [ProductionReleaseService],
  exports: [ProductionReleaseService],
})
export class ReleaseModule {}
