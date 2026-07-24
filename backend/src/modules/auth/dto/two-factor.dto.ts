import { IsString, IsNotEmpty, Length } from 'class-validator';

export class Enable2faDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class Verify2faDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  token: string;

  @IsString()
  @IsNotEmpty()
  tempToken: string;
}

export class Disable2faDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  token: string;
}
