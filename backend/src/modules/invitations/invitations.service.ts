import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateInvitationDto } from './dto/invitation.dto';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async create(companyId: string, invitedById: string, dto: CreateInvitationDto) {
    dto.email = dto.email.toLowerCase().trim();
    // Check if user already exists in this company
    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email, companyId, deletedAt: null },
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists in your company');
    }

    // Check for existing pending invitation
    const existingInvitation = await this.prisma.invitation.findFirst({
      where: { email: dto.email, companyId, status: 'pending' },
    });
    if (existingInvitation) {
      throw new ConflictException('An invitation is already pending for this email');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.invitation.create({
      data: {
        email: dto.email,
        role: dto.role,
        token,
        companyId,
        invitedById,
        expiresAt,
      },
    });

    // Send invitation email
    const inviteUrl = `${process.env.APP_URL || 'http://localhost:5173'}/auth/invite/${token}`;
    await this.emailService.sendInvitation(dto.email, inviteUrl, dto.role).catch((err) => {
      this.logger.error('Invitation email failed:', err);
    });

    return invitation;
  }

  async findAll(companyId: string) {
    return this.prisma.invitation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        invitedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async findByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { company: true },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException(`Invitation has already been ${invitation.status}`);
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    return invitation;
  }

  async accept(
    token: string,
    userData: { password: string; firstName: string; lastName: string; phone?: string },
  ) {
    const invitation = await this.findByToken(token);

    // Create user account
    const passwordHash = await bcrypt.hash(userData.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: invitation.email,
        passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        role: invitation.role,
        companyId: invitation.companyId,
      },
    });

    // Mark invitation as accepted
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });

    return user;
  }

  async resend(companyId: string, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, companyId },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Can only resend pending invitations');
    }

    // Generate new token and extend expiry
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { token, expiresAt },
    });

    // Send email
    const inviteUrl = `${process.env.APP_URL || 'http://localhost:5173'}/auth/invite/${token}`;
    await this.emailService
      .sendInvitation(invitation.email, inviteUrl, invitation.role)
      .catch((err) => {
        this.logger.error('Invitation email failed:', err);
      });

    return { message: 'Invitation resent successfully' };
  }

  async revoke(companyId: string, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, companyId },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Can only revoke pending invitations');
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });

    return { message: 'Invitation revoked successfully' };
  }
}
