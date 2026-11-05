import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
}

/**
 * Access token servisi — jose (HS256), kısa ömürlü (varsayılan 15 dk).
 * Secret: JWT_ACCESS_SECRET (en az 32 karakter, repoya girmez).
 */
@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;
  private readonly issuer = 'santiyepro-api';
  private readonly audience = 'santiyepro-clients';
  /** docs/07: access token kısa ömürlü. Testlerde konfigüre edilebilir. */
  readonly ttlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);

  constructor() {
    const secret = process.env.JWT_ACCESS_SECRET ?? '';
    if (secret.length < 32 && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET en az 32 karakter olmalıdır');
    }
    this.secret = new TextEncoder().encode(
      secret.length >= 32 ? secret : 'dev-only-insecure-access-secret-min-32-chars',
    );
  }

  async signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): Promise<string> {
    return new SignJWT({ ...payload, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.issuer,
        audience: this.audience,
      });
      if (payload.type !== 'access' || typeof payload.sub !== 'string') return null;
      return {
        sub: payload.sub,
        email: String(payload.email ?? ''),
        type: 'access',
      };
    } catch {
      return null;
    }
  }
}
