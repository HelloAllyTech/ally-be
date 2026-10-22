import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LabEvaluatorService } from '../service/lab-evaluator.service';

/**
 * Authenticates AI Lab human evaluators (the /evaluate micro-app) — NOT
 * platform users. Verifies the bearer JWT against the evaluator signing key,
 * requires the `kind: lab_evaluator` claim, checks the tokenVersion (password
 * regeneration revokes old tokens) and attaches `req.evaluator`.
 *
 * The separation holds both ways, and on two separate locks:
 * - a platform token here fails the signature check, because evaluator
 *   tokens are signed with a key derived from the access secret, not the
 *   access secret itself (EVALUATOR_TOKEN_KEY_LABEL), and has no evaluator
 *   `kind` either;
 * - an evaluator token on a platform route fails the same way in reverse,
 *   and JwtStrategy and WebSocketAuthMiddleware also refuse any token whose
 *   `kind` claim is not one they issue (isPlatformTokenKind).
 */
@Injectable()
export class LabEvaluatorGuard implements CanActivate {
  constructor(private readonly evaluatorService: LabEvaluatorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    if (!token) {
      throw new UnauthorizedException();
    }

    const evaluator = await this.evaluatorService.verifyToken(token);
    request.evaluator = { id: evaluator.id, email: evaluator.email };
    return true;
  }
}
