import { SetMetadata } from '@nestjs/common';

export const API_KEY_SCOPE_KEY = 'apiKeyScope';

export const ApiKeyScope = (scope: string) => SetMetadata(API_KEY_SCOPE_KEY, scope);
