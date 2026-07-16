import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from 'src/config/config.service';
import { LabEvaluatorService } from '../service/lab-evaluator.service';

/**
 * Authenticates AI Lab human evaluators (the /evaluate micro-app) — NOT
 * platform users. Verifies the bearer JWT against the access-token secret,
 * requires the dedicated `kind: lab_evaluator` claim (so platform-user tokens
 * are rejected and vice-versa), checks the tokenVersion (password
 * regeneration revokes old tokens) and attaches `req.evaluator`.
 */
@Injectable()
export class LabEvaluatorGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
    private readonly evaluatorService: LabEvaluatorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: { sub?: string; email?: string; kind?: string; tv?: number };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.jwt.accessToken.secret,
      });
    } catch {
      throw new UnauthorizedException();
    }

    const evaluator = await this.evaluatorService.validateToken(payload);
    request.evaluator = { id: evaluator.id, email: evaluator.email };
    return true;
  }
}
