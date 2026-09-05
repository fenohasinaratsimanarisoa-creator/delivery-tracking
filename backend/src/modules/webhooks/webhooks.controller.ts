import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BlockImpersonationGuard } from '../../common/guards/block-impersonation.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentCompanyId } from '../../common/decorators/current-company-id.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@ApiTags('Webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
@Roles('admin')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @UseGuards(BlockImpersonationGuard)
  @ApiOperation({
    summary: 'Create a webhook endpoint',
    description: 'Returns the HMAC secret only once.',
  })
  async create(@CurrentCompanyId() companyId: string, @Body() dto: CreateWebhookDto) {
    return this.service.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all webhooks for the company' })
  async findAll(@CurrentCompanyId() companyId: string) {
    return this.service.findAll(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get webhook details including recent delivery log' })
  async findOne(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.service.findOne(companyId, id);
  }

  @Patch(':id')
  @UseGuards(BlockImpersonationGuard)
  @ApiOperation({ summary: 'Update webhook configuration' })
  async update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook' })
  async remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    await this.service.remove(companyId, id);
    return { message: 'Webhook deleted' };
  }

  @Post(':id/toggle')
  @UseGuards(BlockImpersonationGuard)
  @ApiOperation({ summary: 'Activate or deactivate a webhook' })
  async toggle(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.service.toggle(companyId, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a test ping to the webhook URL' })
  async sendTest(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.service.sendTest(companyId, id);
  }
}
