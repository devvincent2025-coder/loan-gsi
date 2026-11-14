import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { IntegrationDto, LoanProductDto, settingUpdateSchema, SettingDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

@Injectable()
class SettingsService {
  constructor(private prisma: PrismaService, private audit: AuditService, @Inject(APP_ENV) private env: AppEnv) {}

  async all(): Promise<SettingDto[]> {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: [{ namespace: 'asc' }, { key: 'asc' }] });
    return rows.map((r) => ({ key: r.key, namespace: r.namespace, value: r.value, description: r.description, updatedAt: r.updatedAt.toISOString() }));
  }

  async set(key: string, value: unknown, userId: string): Promise<SettingDto> {
    const cur = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!cur) throw new NotFoundException(`Unknown setting ${key}`);
    if (kind(cur.value) !== kind(value)) throw new BadRequestException({ message: `Expected a ${kind(cur.value)} value for ${key}`, code: 'VALIDATION_FAILED' });
    const r = await this.prisma.systemSetting.update({ where: { key }, data: { value: value as never, updatedById: userId } });
    await this.audit.record({ action: 'setting.updated', resourceType: 'SystemSetting', resourceId: key, before: { value: cur.value }, after: { value } });
    return { key: r.key, namespace: r.namespace, value: r.value, description: r.description, updatedAt: r.updatedAt.toISOString() };
  }

  async products(): Promise<LoanProductDto[]> {
    const rows = await this.prisma.loanProduct.findMany({ orderBy: { name: 'asc' } });
    return rows.map((p) => ({
      id: p.id, code: p.code, name: p.name, minAmountKobo: Number(p.minAmountKobo), maxAmountKobo: Number(p.maxAmountKobo), monthlyRateBps: p.monthlyRateBps,
      minTenorMonths: p.minTenorMonths, maxTenorMonths: p.maxTenorMonths, isActive: p.isActive,
    }));
  }

  integrations(): IntegrationDto[] {
    const e = this.env;
    const mk = (key: string, name: string, category: IntegrationDto['category'], mode: 'mock' | 'live', configured: boolean, envVars: string[], note: string): IntegrationDto => ({
      key, name, category, mode, status: mode === 'mock' ? 'healthy' : configured ? 'healthy' : 'unconfigured', envVars, note,
    });
    return [
      mk('sms', e.SMS_PROVIDER === 'africastalking' ? "Africa's Talking SMS" : e.SMS_PROVIDER === 'termii' ? 'Termii SMS' : 'SMS (mock)', 'SMS', e.SMS_PROVIDER === 'mock' ? 'mock' : 'live',
        e.SMS_PROVIDER === 'termii' ? !!e.TERMII_API_KEY : !!e.AT_API_KEY, ['SMS_PROVIDER', 'TERMII_API_KEY', 'TERMII_SENDER_ID', 'AT_USERNAME', 'AT_API_KEY', 'AT_SENDER_ID'], 'Set SMS_PROVIDER=termii|africastalking and the keys to go live.'),
      mk('email', e.EMAIL_PROVIDER === 'resend' ? 'Resend Email' : 'Email (mock)', 'EMAIL', e.EMAIL_PROVIDER === 'mock' ? 'mock' : 'live', !!e.RESEND_API_KEY, ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM'], 'Verify the sending domain (SPF/DKIM) before going live.'),
      mk('whatsapp', e.WHATSAPP_PROVIDER === 'meta' ? 'WhatsApp (Meta Cloud)' : e.WHATSAPP_PROVIDER === 'termii' ? 'WhatsApp (Termii)' : 'WhatsApp (mock)', 'WHATSAPP', e.WHATSAPP_PROVIDER === 'mock' ? 'mock' : 'live',
        e.WHATSAPP_PROVIDER === 'meta' ? !!e.META_WHATSAPP_TOKEN : !!e.TERMII_API_KEY, ['WHATSAPP_PROVIDER', 'META_WHATSAPP_TOKEN', 'META_WHATSAPP_PHONE_ID'], 'Approved message templates are required.'),
      mk('dojah', 'Dojah KYC (BVN / NIN / selfie)', 'KYC', 'mock', false, ['DOJAH_APP_ID', 'DOJAH_SECRET_KEY'], 'Arrives in prompt 2 (interface + mock + live stub).'),
      mk('bureau', 'Credit bureaus (CRC / FirstCentral / CreditRegistry)', 'BUREAU', 'mock', false, ['CRC_USERNAME', 'CRC_PASSWORD'], 'Arrives in prompt 2. Needs a valid BUREAU_PULL consent.'),
      mk('payments', 'Payments & autodebit (Remita / Paystack / NIBSS)', 'PAYMENTS', 'mock', false, ['PAYSTACK_SECRET_KEY', 'REMITA_API_KEY'], 'Arrives in prompt 3.'),
      mk('llm', 'LLM Gateway', 'LLM', 'mock', false, ['LLM_PROVIDER', 'ANTHROPIC_API_KEY'], 'Arrives in prompt 4. PII is redacted before any model call.'),
    ];
  }
}

@Controller('settings')
class SettingsController {
  constructor(private svc: SettingsService) {}

  @Get() @RequirePermission('settings:read')
  async all() { return { settings: await this.svc.all() }; }

  @Get('products') @RequirePermission('product:read')
  products() { return this.svc.products(); }

  @Get('integrations') @RequirePermission('integration:read')
  integrations() { return this.svc.integrations(); }

  @Put(':key') @RequirePermission('settings:update')
  async set(@Param('key') key: string, @Body(new ZodPipe(settingUpdateSchema)) b: z.infer<typeof settingUpdateSchema>, @CurrentUser() u: AuthUser) {
    return this.svc.set(key, b.value, u.id);
  }
}

@Module({ providers: [SettingsService], controllers: [SettingsController] })
export class SettingsModule {}
