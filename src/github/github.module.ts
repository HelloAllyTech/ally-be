import { Module } from '@nestjs/common';
import { GithubActionsService } from './service/github-actions.service';

/**
 * The platform's GitHub REST client: workflow dispatch, run correlation and
 * cancellation, pull-request reads, check rollups, review feedback and merges.
 *
 * It lived in `src/bug-hunter/` because Bug Hunter was the first thing to need
 * it, and Builder has been importing the whole of BugHunterModule to reach it
 * — a module edge that says "Builder depends on Bug Hunter" when what it
 * actually depends on is an HTTP client. The comment on that import asked for
 * this extraction once a third caller appeared; Phase 3's agent hand-off is
 * that caller, so it happens now, before anything is built on the old shape.
 *
 * Nothing about the client changed in the move. It is the same file with the
 * same tests, relocated — the point is the module graph, not the code.
 */
@Module({
  providers: [GithubActionsService],
  exports: [GithubActionsService],
})
export class GithubModule {}
