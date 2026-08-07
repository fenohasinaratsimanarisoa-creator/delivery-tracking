import { IsString, Length } from 'class-validator';

export class OAuthBeginDto {
  @IsString()
  @Length(20, 200)
  codeChallenge: string;
}
