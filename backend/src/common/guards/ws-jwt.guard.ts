import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsAuthService } from '../auth/ws-auth.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private wsAuthService: WsAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient();

    if (client.data?.user) {
      return true;
    }

    try {
      await this.wsAuthService.verify(client);
      return true;
    } catch {
      throw new WsException('Invalid or expired token');
    }
  }
}
