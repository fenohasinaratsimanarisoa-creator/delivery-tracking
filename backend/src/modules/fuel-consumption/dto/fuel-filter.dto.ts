import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class FuelFilterDto extends PaginationDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;
}
