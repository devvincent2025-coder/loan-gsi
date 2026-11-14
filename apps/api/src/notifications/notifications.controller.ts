import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  DeliveryLogDto, InboxDto, notificationTestSchema, Page, pageQuerySchema, TemplateDto, templateUpdateSchema,
} from '@damez/shared';
import { NotificationChannel, DeliveryStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, NoTouch, RequirePermission } from '../common/decorators';
import { paged, skipTake } from '../common/pagination';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const logsQuery = pageQuerySchema.extend({
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP']).optional(),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED']).optional(),
});

@Controller('notifications')
export class NotificationsController {
  constructor(private prisma: PrismaService, private svc: NotificationsService, private audit: AuditService) {}

  @NoTouch()
  @Get('inbox')
  async inbox(@CurrentUser() user: AuthUser): Promise<InboxDto> {
    const [items, unread] = await Promise.all([
      this.prisma.inAppNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.inAppNotification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
    };
  }

  @Post('inbox/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.inAppNotification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('inbox/:id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.inAppNotification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Get('logs')
  @RequirePermission('notification:read')
  async logs(@Query(new ZodPipe(logsQuery)) q: z.infer<typeof logsQuery>): Promise<Page<DeliveryLogDto>> {
    const where: Prisma.NotificationDeliveryWhereInput = {
      ...(q.channel ? { channel: q.channel as NotificationChannel } : {}),
      ...(q.status ? { status: q.status as DeliveryStatus } : {}),
      ...(q.q ? { OR: [{ templateKey: { contains: q.q } }, { recipientMasked: { contains: q.q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notificationDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.notificationDelivery.count({ where }),
    ]);
    return paged(
      rows.map((r) => ({
        id: r.id, channel: r.channel, provider: r.provider, recipient: r.recipientMasked, templateKey: r.templateKey, status: r.status,
        error: r.error, providerMessageId: r.providerMessageId, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
      })),
      total, q.page, q.pageSize,
    );
  }

  @Get('templates')
  @RequirePermission('template:read')
  async templates(): Promise<TemplateDto[]> {
    const rows = await this.prisma.notificationTemplate.findMany({ orderBy: [{ key: 'asc' }, { channel: 'asc' }] });
    return rows.map((t) => ({ id: t.id, key: t.key, channel: t.channel, name: t.name, subject: t.subject, body: t.body, variables: t.variables as string[], isActive: t.isActive }));
  }

  @Put('templates/:id')
  @RequirePermission('template:update')
  async updateTemplate(@Param('id') id: string, @Body(new ZodPipe(templateUpdateSchema)) body: z.infer<typeof templateUpdateSchema>): Promise<TemplateDto> {
    const before = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const t = await this.prisma.notificationTemplate.update({
      where: { id }, data: { body: body.body, ...(body.subject !== undefined ? { subject: body.subject } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) },
    });
    await this.audit.record({
      action: 'template.updated', resourceType: 'NotificationTemplate', resourceId: id,
      before: { subject: before.subject, body: before.body, isActive: before.isActive }, after: { subject: t.subject, body: t.body, isActive: t.isActive },
    });
    return { id: t.id, key: t.key, channel: t.channel, name: t.name, subject: t.subject, body: t.body, variables: t.variables as string[], isActive: t.isActive };
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermission('notification:send')
  async test(@Body(new ZodPipe(notificationTestSchema)) body: z.infer<typeof notificationTestSchema>, @CurrentUser() user: AuthUser) {
    const to = body.channel === 'IN_APP' ? user.id : body.to;
    const r = await this.svc.send({ channel: body.channel, to, templateKey: body.templateKey, variables: body.variables });
    await this.audit.record({ action: 'notification.test_sent', resourceType: 'NotificationDelivery', resourceId: r.deliveryId ?? r.inAppId ?? null, metadata: { channel: body.channel, templateKey: body.templateKey } });
    return r;
  }
}
