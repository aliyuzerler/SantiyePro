import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Zod doğrulama pipe'ı — contracts şemalarını NestJS denetleyicilerine bağlar.
 * Hata zarfı: VALIDATION_ERROR + alan bazlı ayrıntılar (docs/05).
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: issues[0]?.message ?? 'Geçersiz istek gövdesi',
        details: issues,
      });
    }
    return result.data;
  }
}
