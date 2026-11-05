import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  bootstrapRequestSchema,
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  resetPasswordRequestSchema,
  type BootstrapRequest,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type LogoutRequest,
  type RefreshRequest,
  type ResetPasswordRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthService, REFRESH_COOKIE_NAME, REFRESH_TTL_DAYS } from './auth.service.js';
import { ClientInfo, CurrentUser, Public, type ClientMeta } from '../../common/auth/decorators.js';

const REFRESH_COOKIE_MAX_AGE = REFRESH_TTL_DAYS * 24 * 60 * 60_000;

/**
 * Kimlik doğrulama uçları (Faz 02).
 *
 * Web istemcileri refresh token'ı HttpOnly cookie ile alır/gönderir;
 * mobil istemciler gövdedeki refreshToken alanını SecureStore'da saklar.
 * Cookie Secure bayrağı COOKIE_SECURE=true ile (üretim) açılır.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
      maxAge: REFRESH_COOKIE_MAX_AGE,
    };
  }

  private traceId(req: Request): string | undefined {
    return (req as RequestWithTrace).traceId;
  }

  /** İlk kurulum gerekiyor mu? (kurulum ekranı için public) */
  @Public()
  @Get('setup-status')
  @HttpCode(HttpStatus.OK)
  async setupStatus(): Promise<{ setupRequired: boolean }> {
    return { setupRequired: await this.authService.needsSetup() };
  }

  /** İlk admin kurulumu — tek kullanımlık setup token ile. */
  @Public()
  @Post('bootstrap')
  @HttpCode(HttpStatus.CREATED)
  async bootstrap(
    @Body(new ZodValidationPipe(bootstrapRequestSchema)) body: BootstrapRequest,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.authService.bootstrap({
      setupToken: body.setupToken,
      fullName: body.fullName,
      email: body.email,
      phone: body.phone,
      password: body.password,
      meta: { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '', traceId: this.traceId(req) },
    });
    return { message: 'Kurulum tamamlandı. Artık giriş yapabilirsiniz.' };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ClientInfo() client: ClientMeta,
  ) {
    const meta = { ip: client.ip, userAgent: client.userAgent, traceId: this.traceId(req) };
    const result = await this.authService.login({ email: body.email, password: body.password, meta });
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, this.cookieOptions());
    // Mobil istemci refreshToken'ı gövdede alır ve SecureStore'da saklar (docs/07).
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    const meta = { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '', traceId: this.traceId(req) };
    const result = await this.authService.refresh({ refreshToken: body.refreshToken ?? cookieToken, meta });
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, this.cookieOptions());
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(logoutRequestSchema)) body: LogoutRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    await this.authService.logout({
      refreshToken: body.refreshToken ?? cookieToken,
      meta: { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '', traceId: this.traceId(req) },
    });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
  }

  @Get('me')
  async me(@CurrentUser() user: { userId: string; email: string } | undefined) {
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Kimlik doğrulaması gerekli' });
    const me = await this.authService.me(user.userId);
    if (!me) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });
    return me;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @CurrentUser() user: { userId: string } | undefined,
    @Req() req: Request,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Kimlik doğrulaması gerekli' });
    await this.authService.changePassword({
      userId: user.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      meta: { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '', traceId: this.traceId(req) },
    });
  }

  /** Her zaman 202 — e-posta varlığı sızdırılmaz. */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest, @Req() req: Request) {
    await this.authService.forgotPassword({
      email: body.email,
      meta: { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '', traceId: this.traceId(req) },
    });
    return { message: 'E-posta adresiniz kayıtlıysa sıfırlama bağlantısı gönderildi.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest, @Req() req: Request): Promise<void> {
    await this.authService.resetPassword({
      token: body.token,
      newPassword: body.newPassword,
      meta: { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '', traceId: this.traceId(req) },
    });
  }
}
