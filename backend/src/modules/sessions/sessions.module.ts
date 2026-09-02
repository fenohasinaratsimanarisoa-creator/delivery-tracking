import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

// Pas de contrôleur : les routes de session sont exposées par AuthController
// (`/auth/sessions*`), qui ajoute la révocation Redis des access tokens et le
// marquage `isCurrent`. Un second jeu de routes `/sessions*` existait ici,
// inutilisé par le front et sans révocation d'access token — supprimé.
@Module({
  imports: [AuditLogModule],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
