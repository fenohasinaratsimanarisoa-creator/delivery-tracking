import { IsString, Length } from 'class-validator';

export class OAuthExchangeDto {
  @IsString()
  @Length(20, 200)
  code: string;

  @IsString()
  @Length(20, 200)
  verifier: string;
}
