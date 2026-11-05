import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  addProjectMemberRequestSchema,
  createProjectRequestSchema,
  createSiteRequestSchema,
  projectListQuerySchema,
  updateProjectMemberRequestSchema,
  updateProjectRequestSchema,
  updateSiteRequestSchema,
  type AddProjectMemberRequest,
  type CreateProjectRequest,
  type CreateSiteRequest,
  type ProjectListQuery,
  type UpdateProjectMemberRequest,
  type UpdateProjectRequest,
  type UpdateSiteRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { ProjectsService } from './projects.service.js';

/**
 * Projeler ve şantiyeler uçları (Faz 03).
 * Tüm uçlar kimlik doğrulamalı; izinler deny-by-default PermissionsGuard'da,
 * proje kapsamı (üyelik) ise serviste nesne seviyesinde kontrol edilir.
 */
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  /** Proje listesi — sayfalama, arama, durum filtresi ve sıralama zorunlu (Faz 03). */
  @Get()
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Proje listesi (kapsamlı): sayfalama, arama, durum filtresi, sıralama' })
  async list(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(projectListQuerySchema)) query: ProjectListQuery,
  ) {
    return this.projectsService.list(userId ?? '', query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Proje oluşturur; kod kurulum içinde benzersizdir (409)' })
  async create(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(createProjectRequestSchema)) body: CreateProjectRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projectsService.create(userId ?? '', body, this.meta(req, client));
  }

  @Get(':id')
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Proje detayı (şantiyeler ve üyelerle); kapsam dışıysa 404' })
  async detail(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.projectsService.detail(userId ?? '', id);
  }

  @Patch(':id')
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Proje güncelleme; durum geçişleri kurallı, arşivleme = status ARCHIVED' })
  async update(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectRequestSchema)) body: UpdateProjectRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projectsService.update(userId ?? '', id, body, this.meta(req, client));
  }

  // ---------- Şantiyeler ----------

  @Get(':id/sites')
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Projenin şantiyeleri' })
  async listSites(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.projectsService.listSites(userId ?? '', id);
  }

  @Post(':id/sites')
  @HttpCode(201)
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Şantiye oluşturur; ad proje içinde benzersizdir (409)' })
  async createSite(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSiteRequestSchema)) body: CreateSiteRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projectsService.createSite(userId ?? '', id, body, this.meta(req, client));
  }

  @Patch(':id/sites/:siteId')
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Şantiye güncelleme; yanlış projeye bağlı şantiye 404 döner' })
  async updateSite(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Param('siteId') siteId: string,
    @Body(new ZodValidationPipe(updateSiteRequestSchema)) body: UpdateSiteRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projectsService.updateSite(userId ?? '', id, siteId, body, this.meta(req, client));
  }

  // ---------- Üyeler ----------

  @Get(':id/members')
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Proje üyeleri' })
  async listMembers(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.projectsService.listMembers(userId ?? '', id);
  }

  @Post(':id/members')
  @HttpCode(201)
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Proje üyesi ekler; kullanıcı aktif olmalı, mükerrer üye 409' })
  async addMember(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addProjectMemberRequestSchema)) body: AddProjectMemberRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projectsService.addMember(userId ?? '', id, body, this.meta(req, client));
  }

  @Patch(':id/members/:memberId')
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Proje üyesinin kapsam rolünü değiştirir' })
  async updateMember(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body(new ZodValidationPipe(updateProjectMemberRequestSchema)) body: UpdateProjectMemberRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projectsService.updateMember(userId ?? '', id, memberId, body, this.meta(req, client));
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Proje üyesini çıkarır; sorumlu çıkarılırsa sorumluluk boşalır' })
  async removeMember(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    await this.projectsService.removeMember(userId ?? '', id, memberId, this.meta(req, client));
  }
}
