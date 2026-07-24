import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class CompanyScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.type === 'platform_admin') {
      return true;
    }

    if (!user || !user.companyId) {
      throw new ForbiddenException('No company scope for user');
    }

    const companyIdParam = request.params?.companyId;
    if (companyIdParam && companyIdParam !== user.companyId) {
      throw new ForbiddenException('Cannot access data from another company');
    }

    request.companyId = user.companyId;
    return true;
  }
}
