import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class BlockImpersonationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.impersonatedBy) {
      throw new ForbiddenException('This action is not allowed during an impersonated session');
    }

    return true;
  }
}
