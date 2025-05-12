import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ExecutionManager } from './execution-manager';

@Injectable()
export class ExecutionContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    ExecutionManager.runWithContext(() => {
      next();
    }, req.path);
  }
}
