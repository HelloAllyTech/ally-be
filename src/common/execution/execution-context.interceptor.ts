import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ExecutionManager } from './execution-manager';

@Injectable()
export class ExecutionContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    return ExecutionManager.runWithContext(() => next.handle(), request.path);
  }
}
