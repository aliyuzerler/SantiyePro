import { Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Argon2id parola hash servisi (docs/07).
 * OWASP önerisi: m=19456 (19 MiB), t=2, p=1.
 * @node-rs/argon2 varsayılan algoritması zaten Argon2id'dir (isolatedModules
 * uyumu için const enum üye erişimi kullanılmaz; çıktı $argon2id$ ile başlar).
 */
@Injectable()
export class PasswordHasherService {
  private readonly options = {
    memoryCost: 19456,
    timeCost: 2,
  } as const;

  hash(plain: string): Promise<string> {
    return argonHash(plain, this.options);
  }

  verify(hashValue: string, plain: string): Promise<boolean> {
    return argonVerify(hashValue, plain);
  }
}
