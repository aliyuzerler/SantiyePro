import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  addTaskCommentRequestSchema,
  createTaskRequestSchema,
  taskListQuerySchema,
  updateTaskRequestSchema,
  type AddTaskCommentRequest,
  type CreateTaskRequest,
  type TaskListQuery,
  type UpdateTaskRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { TasksService } from './tasks.service.js';

/**
 * Görev yönetimi uçları (Faz 04).
 *
 * Uç izinleri deny-by-default PermissionsGuard'da; ayrıntılı yetki ayrımı
 * (task.edit / task.assign / atanan kişinin kendi durum değişikliği) ve proje
 * kapsamı servis katmanında nesne seviyesinde uygulanır (docs/06).
 */
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  @Get()
  @RequirePermissions('task.view')
  @ApiOperation({ summary: 'Görev listesi: proje/durum/öncelik/atanan/gecikmiş filtreleri, arama, sayfalama' })
  async list(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(taskListQuerySchema)) query: TaskListQuery,
  ) {
    return this.tasksService.list(userId ?? '', query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('task.edit')
  @ApiOperation({ summary: 'Görev oluşturur; atama task.assign izni ister, durum geçmişi TODO kaydıyla başlar' })
  async create(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(createTaskRequestSchema)) body: CreateTaskRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.tasksService.create(userId ?? '', body, this.meta(req, client));
  }

  @Get(':id')
  @RequirePermissions('task.view')
  @ApiOperation({ summary: 'Görev detayı: yorumlar ve durum geçmişiyle; kapsam dışıysa 404' })
  async detail(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.tasksService.detail(userId ?? '', id);
  }

  @Patch(':id')
  @RequirePermissions('task.view')
  @ApiOperation({
    summary:
      'Görev güncelleme: alan değişikliği task.edit, atama task.assign ister; durum geçişi atanan kişiye de açıktır',
  })
  async update(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTaskRequestSchema)) body: UpdateTaskRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.tasksService.update(userId ?? '', id, body, this.meta(req, client));
  }

  @Get(':id/comments')
  @RequirePermissions('task.view')
  @ApiOperation({ summary: 'Görev yorumları (eskiden yeniye)' })
  async listComments(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.tasksService.listComments(userId ?? '', id);
  }

  @Post(':id/comments')
  @HttpCode(201)
  @RequirePermissions('task.view')
  @ApiOperation({ summary: 'Göreve yorum ekler (kapsamdaki her proje üyesi)' })
  async addComment(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addTaskCommentRequestSchema)) body: AddTaskCommentRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.tasksService.addComment(userId ?? '', id, body.body, this.meta(req, client));
  }
}
