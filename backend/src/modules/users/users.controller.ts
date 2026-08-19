import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto, ChangePasswordDto, UpdateEmailDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BlockImpersonationGuard } from '../../common/guards/block-impersonation.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsageGuard } from '../../common/guards/usage.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { normalizePagination } from '../../common/utils/pagination';

@Controller('users')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(RolesGuard, UsageGuard)
  @Roles('admin')
  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateUserDto) {
    return this.usersService.create(companyId, dto);
  }

  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole: string,
    @Param('id') id: string,
  ) {
    return this.usersService.findById(id, companyId, currentUserId, currentUserRole);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
  ) {
    const { page: p, limit: l } = normalizePagination(page, limit);
    return this.usersService.findAll(companyId, p, l);
  }

  @Patch('me/profile')
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/email')
  updateEmail(@CurrentUser('id') userId: string, @Body() dto: UpdateEmailDto) {
    return this.usersService.updateEmail(userId, dto.email!, dto.currentPassword);
  }

  @Get('me/preferences')
  getPreferences(@CurrentUser('id') userId: string) {
    return this.usersService.getPreferences(userId);
  }

  @Patch('me/preferences')
  updatePreferences(@CurrentUser('id') userId: string, @Body() body: Record<string, boolean>) {
    return this.usersService.updatePreferences(userId, body);
  }

  @UseGuards(BlockImpersonationGuard)
  @Patch('me/password')
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(userId, dto);
  }

  @UseGuards(BlockImpersonationGuard)
  @Get('me/export')
  async exportPersonalData(@CurrentUser() user: any) {
    return this.usersService.exportPersonalData(user.id, user.companyId);
  }

  @UseGuards(BlockImpersonationGuard)
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyAccount(@CurrentUser() user: any) {
    await this.usersService.anonymizeUser(user.id, user.companyId);
  }

  @Patch('me/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async updateAvatar(@CurrentUser('id') userId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size must be less than 5MB');
    }

    // In production, upload to S3/Cloudinary and return URL
    // For now, return a placeholder URL
    const avatarUrl = `/uploads/avatars/${file.filename}`;

    return this.usersService.updateAvatar(userId, { avatarUrl });
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') currentUserId: string,
  ) {
    return this.usersService.update(companyId, id, dto, currentUserId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser('id') currentUserId: string,
  ) {
    return this.usersService.remove(companyId, id, currentUserId);
  }
}
