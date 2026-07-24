import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentCompanyId } from '../../common/decorators/current-company-id.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyCreatedResponseDto } from './dto/api-key-response.dto';

@ApiTags('API Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
    description: 'Returns the full key only once. Store it securely.',
  })
  @ApiCreatedResponse({ type: ApiKeyCreatedResponseDto })
  async create(@CurrentCompanyId() companyId: string, @Body() dto: CreateApiKeyDto) {
    return this.service.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for the company (key values are not returned)' })
  @ApiOkResponse({ type: [ApiKeyResponseDto] })
  async findAll(@CurrentCompanyId() companyId: string) {
    return this.service.findAll(companyId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key (soft-deactivate)' })
  async remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    await this.service.remove(companyId, id);
    return { message: 'API key revoked' };
  }
}
