import { Body, Controller, Get, Global, HttpCode, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CONSENT_PURPOSES, ConsentPurpose } from '@damez/shared';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const grantSchema = z.object({
  subjectType: z.enum(['CUSTOMER', 'STAFF']).default('CUSTOMER'), subjectId: z.string().min(1), purpose: z.enum(CONSENT_PURPOSES),
  lawfulBasis: z.enum(['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST']).default('CONSENT'),
  textVersion: z.string().min(1), channel: z.string().default('WEB'), expiresAt: z.string().datetime().optional(), evidence: z.string().optional(),
});

/**
 * Reusable consent records (NDPA 2023). Any module that needs consent (bureau pulls, GSI/autodebit, LLM processing)
 * calls `hasValidConsent` first and records the check in its own audit entry.
 */
@Injectable()
export class ConsentService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async grant(input: z.infer<typeof grantSchema>, recordedById: string | null, ctx?: { ip?: string | null; userAgent?: string | null }) {
    const c = await this.prisma.consent.create({
      data: {
        subjectType: input.subjectType, subjectId: input.subjectId, purpose: input.purpose, lawfulBasis: input.lawfulBasis, textVersion: input.textVersion, channel: input.channel,
        ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null, recordedById, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        evidenceHash: input.evidence ? createHash('sha256').update(input.evidence).digest('hex') : null,
      },
    });
    await this.audit.record({ action: 'consent.granted', resourceType: 'Consent', resourceId: c.id, after: { subjectType: c.subjectType, subjectId: c.subjectId, purpose: c.purpose, textVersion: c.textVersion } });
    return c;
  }

  async revoke(id: string) {
    const c = await this.prisma.consent.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Consent not found');
    const r = await this.prisma.consent.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    await this.audit.record({ action: 'consent.revoked', resourceType: 'Consent', resourceId: id, before: { status: c.status }, after: { status: 'REVOKED' } });
    return r;
  }

  async hasValidConsent(subjectId: string, purpose: ConsentPurpose, subjectType = 'CUSTOMER'): Promise<boolean> {
    const now = new Date();
    const c = await this.prisma.consent.findFirst({
      where: { subjectType, subjectId, purpose, status: 'GRANTED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { grantedAt: 'desc' },
    });
    return !!c;
  }

  list(subjectId: string, subjectType = 'CUSTOMER') {
    return this.prisma.consent.findMany({ where: { subjectType, subjectId }, orderBy: { grantedAt: 'desc' } });
  }
}

@Controller('consents')
class ConsentController {
  constructor(private svc: ConsentService) {}
  @Get() @RequirePermission('consent:read')
  list(@Query('subjectId') subjectId: string) { return this.svc.list(String(subjectId ?? '')); }
  @Post() @HttpCode(200) @RequirePermission('consent:manage')
  grant(@CurrentUser() u: AuthUser, @Body(new ZodPipe(grantSchema)) b: z.infer<typeof grantSchema>) { return this.svc.grant(b, u.id); }
  @Post(':id/revoke') @HttpCode(200) @RequirePermission('consent:manage')
  revoke(@Param('id') id: string) { return this.svc.revoke(id); }
}

@Global()
@Module({ providers: [ConsentService], controllers: [ConsentController], exports: [ConsentService] })
export class ConsentModule {}
