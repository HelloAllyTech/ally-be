// TODO: Implement authkey guard based on service name metadata decorator

import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class AuthkeyGuard extends AuthGuard('authkey') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authkey = request.headers['x-authkey'];
    if (!authkey) {
      //throw new UnauthorizedException('No authkey provided');
      return true;
    }
    return super.canActivate(context);
  }
}
