// .env en başta yüklenir; PrismaService kurulum anında DATABASE_URL'e erişir.
// override: kalıtımla gelen (ör. host makineden sızan) DATABASE_URL gibi
// değişkenlerin uygulamanın kendi .env'i tarafından ezilmesini garanti eder.
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';
import { traceIdMiddleware } from './common/trace-id.middleware.js';
import { securityHeadersMiddleware } from './common/security-headers.middleware.js';
import cookieParser from 'cookie-parser';


/**
 * ŞantiyePro API giriş noktası.
 * Sözleşme: docs/03-architecture.md, docs/05-api-contracts.md
 * - Base path: /api/v1
 * - OpenAPI: /api/v1/docs
 * - Merkezi hata zarfı: { error: { code, message, details? }, traceId }
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const isProduction = process.env.NODE_ENV === 'production';

  const expressApp = app.getHttpAdapter().getInstance();
  // Üretim sarfı: 'x-powered-by' başlığını kaldır (teknoloji izi bırakma).
  expressApp.disable('x-powered-by');

  // Trust proxy (docs/07 + docs/10): API Caddy arkasında çalışırken req.ip
  // gerçek istemci IP'si olmalı — aksi halde IP bazlı login rate limiti tüm
  // kullanıcıları tek kovada sayar. Varsayılan: üretimde 1 hop (compose
  // topolojisi; API portu dış ağa yayımlanmaz), geliştirmede kapalı.
  // Proxy'suz doğrudan erişimde TRUST_PROXY=0 verilmelidir.
  const trustProxy = process.env.TRUST_PROXY ?? (isProduction ? '1' : 'false');
  if (trustProxy !== 'false' && trustProxy !== '0') {
    expressApp.set('trust proxy', Number(trustProxy) || 1);
  }

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3100')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  // Refresh token cookie'si (web): HttpOnly + SameSite=Strict (docs/07).
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(traceIdMiddleware);
  app.use(securityHeadersMiddleware);

  // Swagger yalnızca üretim dışında açıktır: şema keşfi üretime maruz bırakılmaz.
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ŞantiyePro API')
      .setDescription('Şantiye yönetim sistemi REST API (tek müşteri kurulumu)')
      .setVersion(process.env.APP_VERSION ?? '0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  logger.log(`API hazır: http://localhost:${port}/api/v1/health`);
}

void bootstrap();
