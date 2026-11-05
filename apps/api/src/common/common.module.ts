import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { MediaStorageService } from './media/media-storage.service.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { JwtService } from './auth/jwt.service.js';
import { PermissionsGuard } from './auth/permissions.guard.js';

/**
 * Ortak altyapı modülü (global): denetim günlüğü, parola hash, rate limit,
 * JWT ve global guard'lar (APP_GUARD app.module'de kaydedilir).
 */
@Global()
@Module({
  providers: [AuditService, MediaStorageService, PasswordHasherService, RateLimiterService, JwtService, JwtAuthGuard, PermissionsGuard],
  exports: [AuditService, MediaStorageService, PasswordHasherService, RateLimiterService, JwtService, JwtAuthGuard, PermissionsGuard],
})
export class CommonModule {}
