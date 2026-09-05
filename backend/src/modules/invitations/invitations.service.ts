import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyScopedContext } from '../../common/tenant/company-scoped-context';
import { EmailService } from '../email/email.service';
import { CreateInvitationDto } from './dto/invitation.dto';

// Le token d'invitation donne, à qui le connaît, la création d'un compte au
// rôle porté par l'invitation (POST /invitations/:token/accept, public) — une
// fuite de la table `invitations` ne doit pas permettre de rejouer un accept.
// On stocke un hash (même principe que les API keys, cf. api-keys.service.ts),
// jamais le token en clair : la colonne `token` (@unique) contient désormais
// sha256(token brut), le token brut n'existe qu'en mémoire le temps de l'email.
function hashInvitationToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  private async sendInvitationEmail(email: string, rawToken: string, role: string) {
    const inviteUrl = `${process.env.APP_URL || 'http://localhost:5173'}/auth/invite/${rawToken}`;
    await this.emailService.sendInvitation(email, inviteUrl, role).catch((err) => {
      this.logger.error('Invitation email failed:', err);
    });
  }

  async create(companyId: string, invitedById: string, dto: CreateInvitationDto) {
    dto.email = dto.email.toLowerCase().trim();
    // Unicité GLOBALE de l'email, comme dans auth.service.ts register() : un
    // compte existe déjà sur la plateforme pour cette adresse, quelle que soit
    // l'entreprise — l'invitation serait sinon refusée à l'acceptation.
    // Le contexte tenant est désactivé pour cette requête PRÉCISE (autrement
    // le middleware injecterait companyId dans le where d'un findUnique).
    const existingUser = await CompanyScopedContext.run(null, () =>
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    );
    if (existingUser) {
      throw new ConflictException(
        'Cette adresse email est déjà associée à un compte sur la plateforme',
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

    // Le pré-check findFirst ci-dessous est best-effort (message d'erreur clair
    // dans le cas courant) ; la garantie contre la race condition est l'index
    // unique PARTIEL en base (migration 20260905210000, status='pending' only),
    // capturé via le catch P2002 plus bas.
    const existingInvitation = await this.prisma.invitation.findFirst({
      where: { email: dto.email, companyId, status: 'pending' },
    });
    if (existingInvitation) {
      throw new ConflictException('An invitation is already pending for this email');
    }

    let invitation;
    try {
      invitation = await this.prisma.invitation.create({
        data: {
          email: dto.email,
          role: dto.role,
          token: hashInvitationToken(rawToken),
          companyId,
          invitedById,
          expiresAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An invitation is already pending for this email');
      }
      throw err;
    }

    await this.sendInvitationEmail(dto.email, rawToken, dto.role);

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

  async findByToken(rawToken: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: hashInvitationToken(rawToken) },
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

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          firstName: userData.firstName,
          lastName: userData.lastName,
          phone: userData.phone,
          role: invitation.role,
          companyId: invitation.companyId,
        },
        // select EXPLICITE : ne JAMAIS renvoyer passwordHash / resetTokenHash /
        // totpSecret / refreshTokenHash dans la réponse HTTP (le contrôleur
        // renvoie cet objet tel quel). Cohérent avec users.service.create().
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          companyId: true,
          createdAt: true,
        },
      });

      if (invitation.role === 'driver') {
        const existingDriver = await tx.driver.findFirst({
          where: { companyId: invitation.companyId, email: invitation.email, deletedAt: null },
        });
        if (existingDriver) {
          await tx.driver.update({
            where: { id: existingDriver.id },
            data: { userId: createdUser.id },
          });
        } else {
          await tx.driver.create({
            data: {
              firstName: userData.firstName,
              lastName: userData.lastName,
              email: invitation.email,
              phone: userData.phone,
              licenseNumber: `DRV-${createdUser.id.slice(0, 8)}`,
              companyId: invitation.companyId,
              userId: createdUser.id,
            },
          });
        }
      }

      // Statut "accepted" posé DANS la même transaction que la création du
      // compte : un crash entre les deux laissait auparavant le compte créé
      // mais l'invitation "pending" à vie (un second accept() retentait de
      // créer le même user → 409 générique, invitation bloquée définitivement).
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });

      return createdUser;
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
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { token: hashInvitationToken(rawToken), expiresAt },
    });

    await this.sendInvitationEmail(invitation.email, rawToken, invitation.role);

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
