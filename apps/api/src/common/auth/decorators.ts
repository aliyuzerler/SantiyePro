import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Kimlik doğrulaması gerektirmeyen uçlar (deny-by-default kuralının istisnaları). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Uç için zorunlu izinler (deny-by-default; belirtilmezse yalnızca kimlik doğrulaması). */
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: string[]): MethodDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Kimliği doğrulanmış kullanıcı bilgisi (JwtAuthGuard doldurur). */
export interface AuthenticatedUser {
  userId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    return ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
  },
);

/** İstemci meta bilgisi (rate limit ve audit için). */
export interface ClientMeta {
  ip: string;
  userAgent: string;
}

export const ClientInfo = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientMeta => {
  const req = ctx.switchToHttp().getRequest();
  const ip = (req.ip ?? req.socket?.remoteAddress ?? '') as string;
  return { ip, userAgent: String(req.headers?.['user-agent'] ?? '') };
});
