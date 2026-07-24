import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController, PublicInvitationsController } from './invitations.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [InvitationsController, PublicInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
