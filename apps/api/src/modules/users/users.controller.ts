import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import { paginationQuerySchema, createUserRequestSchema, updateUserRequestSchema, type CreateUserRequest, type UpdateUserRequest } from '@santiyepro/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { RequirePermissions, ClientInfo, CurrentUser, type ClientMeta } from '../../common/auth/decorators.js';
import { UsersService } from './users.service.js';

const searchQuerySchema = z.object({ search: z.string().max(120).optional() });
type SearchQuery = z.infer<typeof searchQuerySchema>;

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  /** Kullanıcı listesi — 'user.view' izni (Firma yöneticisi + proje yöneticisi). */
  @Get('users')
  @RequirePermissions('user.view')
  async list(
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: { page: number; pageSize: number },
    @Query(new ZodValidationPipe(searchQuerySchema)) search: SearchQuery,
  ) {
    return this.usersService.list(query.page, query.pageSize, search.search);
  }

  /** Sistem rolleri — kurulum diyaloğu için. */
  @Get('roles')
  @RequirePermissions('user.view')
  async roles() {
    return this.usersService.listRoles();
  }

  /** Kullanıcı oluşturma — 'user.manage' izni (yalnızca firma yöneticisi). */
  @Post('users')
  @RequirePermissions('user.manage')
  async create(
    @Body(new ZodValidationPipe(createUserRequestSchema)) body: CreateUserRequest,
    @CurrentUser() actor: { userId: string } | undefined,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.usersService.create({
      fullName: body.fullName,
      email: body.email,
      phone: body.phone,
      password: body.password,
      roles: body.roles,
      actorUserId: actor?.userId ?? '',
      meta: this.meta(req, client),
    });
  }

  /** Kullanıcı güncelleme (ad/telefon/roller/status) — 'user.manage' izni. */
  @Patch('users/:id')
  @RequirePermissions('user.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserRequestSchema)) body: UpdateUserRequest,
    @CurrentUser() actor: { userId: string } | undefined,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.usersService.update({
      id,
      fullName: body.fullName,
      phone: body.phone,
      status: body.status,
      roles: body.roles,
      actorUserId: actor?.userId ?? '',
      meta: this.meta(req, client),
    });
  }
}
