import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import { Public } from '../../common/auth/decorators.js';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Genel sağlık ucu — süreç ve sürüm bilgisi. */
  @Get()
  @ApiOperation({ summary: 'Genel sağlık bilgisi' })
  @ApiResponse({ status: 200 })
  health() {
    return this.healthService.liveness();
  }

  /** Liveness — süreç ayakta mı; bağımlılıklara bakmaz. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200 })
  live() {
    return this.healthService.liveness();
  }

  /** Readiness — veritabanı dahil bağımlılıklar hazır mı. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 503 })
  async ready(@Res() res: Response) {
    const result = await this.healthService.readiness();
    res.status(result.httpStatus === 503 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK).json(result.response);
  }
}
