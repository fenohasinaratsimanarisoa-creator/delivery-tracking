import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CompanyScopeInterceptor } from '../interceptors/company-scope.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: CompanyScopeInterceptor,
    },
  ],
})
export class TenantModule {}
