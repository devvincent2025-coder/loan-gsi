import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Post,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { z } from 'zod';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { APP_ENV, AppEnv, ConfigModule } from '../config/config.module';
import { CryptoModule } from '../crypto/crypto.module';
import { RequirePermission, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthUser } from '../common/auth-user';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import type { TokenType } from '@prisma/client';

// ─── PiiDetectorService ───────────────────────────────────────────────────────

@Injectable()
export class PiiDetectorService {
  /** Returns detected Nigerian PII type strings; never throws. */
  detectTypes(text: string): string[] {
    const found = new Set<string>();

    // 11-digit standalone numbers → potential BVN or NIN
    if (/\b\d{11}\b/.test(text)) {
      found.add('BVN');
      found.add('NIN');
    }

    // 10-digit standalone numbers → potential NUBAN account
    if (/\b\d{10}\b/.test(text)) {
      found.add('NUBAN');
    }

    // Nigerian phone numbers: local (0[789][01] + 8 digits) or international (+234[789] + 9 digits)
    if (/(?:0[789][01]\d{8}|\+234[789]\d{9})/.test(text)) {
      found.add('PHONE');
    }

    // Standard email pattern
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) {
      found.add('EMAIL');
    }

    return Array.from(found);
  }
}

// ─── Vault crypto helpers ─────────────────────────────────────────────────────

function resolveVaultKey(env: AppEnv): Buffer {
  if (env.PII_VAULT_MASTER_KEY) {
    const key = Buffer.from(env.PII_VAULT_MASTER_KEY, 'base64url');
    if (key.length !== 32) throw new Error('PII_VAULT_MASTER_KEY must decode to 32 bytes');
    return key;
  }
  // Fall back to first key in ENCRYPTION_KEYS "v1:base64key,v2:base64key2,..."
  const firstEntry = env.ENCRYPTION_KEYS.split(',')[0].trim();
  const colonIdx = firstEntry.indexOf(':');
  const keyB64 = firstEntry.slice(colonIdx + 1);
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('First ENCRYPTION_KEYS entry must decode to 32 bytes');
  return key;
}

function vaultEncrypt(plaintext: string, aad: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

function vaultDecrypt(payload: string, aad: string, key: Buffer): string {
  const [iv, tag, ct] = payload.split(':');
  if (!iv || !tag || ct === undefined) throw new Error('Malformed vault ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// 36^6 = 2,176,782,336 — enough entropy for token suffixes; fits in uint32
const TOKEN_SPACE = 36 ** 6;
const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function deriveTokenSuffix(key: Buffer, tokenType: string, tenantId: string, value: string): string {
  const hmac = createHmac('sha256', key).update(`${tokenType}:${tenantId}:${value}`).digest();
  let n = hmac.readUInt32BE(0) % TOKEN_SPACE;
  let result = '';
  do {
    result = BASE36[n % 36] + result;
    n = Math.floor(n / 36);
  } while (n > 0);
  return result.padStart(6, '0');
}

function maskValue(value: string, tokenType: TokenType): string {
  switch (tokenType) {
    case 'BVN':
    case 'NIN':
      // Show first 3 and last 2; mask middle
      return value.length >= 5
        ? `${value.slice(0, 3)}${'•'.repeat(value.length - 5)}${value.slice(-2)}`
        : '•••••';
    case 'NUBAN':
      return value.length >= 6
        ? `${value.slice(0, 3)}${'•'.repeat(value.length - 6)}${value.slice(-3)}`
        : '••••••••••';
    case 'PHONE':
      return value.length >= 7
        ? `${value.slice(0, 4)}${'•'.repeat(value.length - 7)}${value.slice(-3)}`
        : '•••••••••••';
    case 'EMAIL': {
      const [local, domain] = value.split('@');
      if (!domain) return '••••••';
      const visibleLocal = local.slice(0, Math.min(2, local.length));
      return `${visibleLocal}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    }
    default:
      return '••••••';
  }
}

// ─── TokenizationService ──────────────────────────────────────────────────────

@Injectable()
export class TokenizationService {
  private readonly log = new Logger('PiiVault');
  private readonly tenantId = 'damez';
  private readonly vaultKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly detector: PiiDetectorService,
    @Inject(APP_ENV) env: AppEnv,
  ) {
    this.vaultKey = resolveVaultKey(env);
  }

  async tokenize(value: string, tokenType: TokenType, scope?: string): Promise<string> {
    const suffix = deriveTokenSuffix(this.vaultKey, tokenType, this.tenantId, value);
    const token = `${tokenType}_${suffix}`;

    const existing = await this.prisma.piiToken.findUnique({ where: { token } });
    if (existing) {
      await this.prisma.piiToken.update({ where: { token }, data: { lastUsedAt: new Date() } });
      return token;
    }

    const aad = `pii_vault:${tokenType}:${this.tenantId}:${token}`;
    const encValue = vaultEncrypt(value, aad, this.vaultKey);

    await this.prisma.piiToken.create({
      data: { token, tokenType, tenantId: this.tenantId, scope: scope ?? null, encValue },
    });

    await this.audit.record({
      action: 'pii_vault.token_created',
      resourceType: 'PiiToken',
      resourceId: token,
      metadata: { tokenType, scope: scope ?? null },
    });

    return token;
  }

  async detokenize(token: string, requesterId?: string, purpose?: string): Promise<string> {
    const row = await this.prisma.piiToken.findUnique({ where: { token } });
    if (!row) throw new ForbiddenException('Token not found');
    if (row.expiresAt && row.expiresAt < new Date()) throw new ForbiddenException('Token expired');

    const aad = `pii_vault:${row.tokenType}:${row.tenantId}:${token}`;
    const value = vaultDecrypt(row.encValue, aad, this.vaultKey);

    await Promise.all([
      this.prisma.tokenRevealLog.create({
        data: {
          token,
          tokenType: row.tokenType,
          requesterId: requesterId ?? null,
          purpose: purpose ?? 'unspecified',
          ip: null,
        },
      }),
      this.prisma.piiToken.update({ where: { token }, data: { lastUsedAt: new Date() } }),
    ]);

    await this.audit.record({
      action: 'pii_vault.token_revealed',
      resourceType: 'PiiToken',
      resourceId: token,
      actorId: requesterId ?? null,
      metadata: { tokenType: row.tokenType, purpose: purpose ?? 'unspecified' },
    });

    return value;
  }

  async getDisplayMask(token: string): Promise<string> {
    const row = await this.prisma.piiToken.findUnique({ where: { token } });
    if (!row) return '••••••';
    const aad = `pii_vault:${row.tokenType}:${row.tenantId}:${token}`;
    const value = vaultDecrypt(row.encValue, aad, this.vaultKey);
    return maskValue(value, row.tokenType);
  }

  /** Returns detected PII type strings; never throws. */
  scanForRawPii(text: string): string[] {
    try {
      return this.detector.detectTypes(text);
    } catch {
      return [];
    }
  }

  /** Throws ForbiddenException and writes LlmBlockLog if raw PII is detected in text. */
  async blockIfPii(text: string, feature: string, userId?: string): Promise<void> {
    const types = this.detector.detectTypes(text);
    if (types.length === 0) return;

    // We hash the text to allow incident correlation without persisting potentially-PII content.
    // The hash alone does not reveal any PII value.
    const { createHash } = await import('crypto');
    const requestHash = createHash('sha256').update(text).digest('hex');

    await this.prisma.llmBlockLog.create({
      data: {
        feature,
        userId: userId ?? null,
        detectedTerms: types,
        requestHash,
      },
    });

    this.log.warn({ feature, userId, types }, 'Raw PII detected in LLM prompt; request blocked');
    throw new ForbiddenException(
      `Raw PII detected (${types.join(', ')}). Tokenize values before sending to LLM.`,
    );
  }
}

// ─── Zod request schemas ──────────────────────────────────────────────────────

const TOKEN_TYPES = ['CUST', 'BVN', 'NIN', 'PHONE', 'EMAIL', 'NUBAN', 'ADDR', 'DEVICE', 'FREETEXT'] as const;

const CreateTokenBody = z.object({
  value: z.string().min(1),
  tokenType: z.enum(TOKEN_TYPES),
  scope: z.string().optional(),
});

const DetokenizeBody = z.object({
  token: z.string().min(1),
  purpose: z.string().min(1),
});

// ─── PiiVaultController ───────────────────────────────────────────────────────

@Controller('pii-vault')
export class PiiVaultController {
  constructor(
    private readonly tokenization: TokenizationService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('tokens')
  @RequirePermission('pii:reveal')
  @HttpCode(201)
  async createToken(@Body(new ZodPipe(CreateTokenBody)) body: z.infer<typeof CreateTokenBody>) {
    const token = await this.tokenization.tokenize(body.value, body.tokenType as TokenType, body.scope);
    const displayMask = await this.tokenization.getDisplayMask(token);
    return { token, displayMask };
  }

  @Post('detokenize')
  @RequirePermission('pii:reveal')
  @HttpCode(200)
  async detokenize(
    @Body(new ZodPipe(DetokenizeBody)) body: z.infer<typeof DetokenizeBody>,
    @CurrentUser() user: AuthUser,
  ) {
    const value = await this.tokenization.detokenize(body.token, user.id, body.purpose);
    return { value };
  }

  @Get('leak-report')
  @RequirePermission('llm:settings')
  async leakReport() {
    const periodDays = 30;
    const since = new Date(Date.now() - periodDays * 86_400_000);

    const [blockLogs, revealLogs] = await Promise.all([
      this.prisma.llmBlockLog.findMany({ where: { createdAt: { gte: since } } }),
      this.prisma.tokenRevealLog.findMany({ where: { createdAt: { gte: since } } }),
    ]);

    const blocksByFeature: Record<string, number> = {};
    const blocksByType: Record<string, number> = {};
    for (const b of blockLogs) {
      blocksByFeature[b.feature] = (blocksByFeature[b.feature] ?? 0) + 1;
      const terms = Array.isArray(b.detectedTerms) ? (b.detectedTerms as string[]) : [];
      for (const t of terms) {
        blocksByType[t] = (blocksByType[t] ?? 0) + 1;
      }
    }

    const userRevealCount: Record<string, number> = {};
    for (const r of revealLogs) {
      if (r.requesterId) {
        userRevealCount[r.requesterId] = (userRevealCount[r.requesterId] ?? 0) + 1;
      }
    }

    const revealsByUser = await Promise.all(
      Object.entries(userRevealCount).map(async ([userId, count]) => {
        const staff = await this.prisma.staffUser.findUnique({
          where: { id: userId },
          select: { fullName: true },
        });
        return { userId, userName: staff?.fullName ?? userId, count };
      }),
    );

    return {
      periodDays,
      blockedRequests: blockLogs.length,
      blocksByFeature,
      blocksByType,
      revealEvents: revealLogs.length,
      revealsByUser,
      detectorHitRate: blockLogs.length > 0 ? 1 : 0,
    };
  }
}

// ─── PiiVaultModule ───────────────────────────────────────────────────────────

@Module({
  imports: [PrismaModule, CryptoModule, AuditModule, ConfigModule],
  providers: [PiiDetectorService, TokenizationService],
  controllers: [PiiVaultController],
  exports: [TokenizationService, PiiDetectorService],
})
export class PiiVaultModule {}
