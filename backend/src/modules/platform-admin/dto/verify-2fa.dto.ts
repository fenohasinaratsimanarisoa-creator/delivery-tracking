import { IsString, Length } from 'class-validator';

export class PlatformAdminVerify2faDto {
  @IsString()
  tempToken: string;

  @IsString()
  @Length(6, 6)
  token: string;
}
