import { IsEmail, IsEnum, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsEnum(UserRole)
  role: UserRole;
}

export class InvitationResponseDto {
  id: string;

  email: string;

  role: UserRole;

  token: string;

  status: string;

  expiresAt: Date;

  createdAt: Date;

  acceptedAt?: Date;
}

export class ResendInvitationDto {
  @IsString()
  invitationId: string;
}

export class RevokeInvitationDto {
  @IsString()
  invitationId: string;
}
