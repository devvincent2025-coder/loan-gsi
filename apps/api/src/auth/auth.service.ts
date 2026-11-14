import { HttpException, Inject, Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { LoginResponse, Me, SessionDto, TotpEnrollResponse } from '@damez/shared';
import { Prisma, LoginOutcome } from '@prisma/client';
import { createHash } from 'crypto';
import { APP_ENV, AppEnv } from '../config/config.module';
import { AuthUser } from '../common/auth-user';
import { FieldCipher } from '../crypto/field-cipher';
import { PasswordService } from '../crypto/password.service';
import { TokenService } from '../crypto/token.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

authenticator.options = { window: 1, step: 30, digits: 6 };

export interface ClientCtx { ip: string | null; userAgent: string | null }
const CHALLENGE_TTL = 5 * 60;

export function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_ENV) private env: AppEnv,
    private prisma: PrismaService,
    private passwords: PasswordService,
    private tokens: TokenService,
    private cipher: FieldCipher,
    private audit: AuditService,
  ) {}

  /* ───── step 1: password ───── */
  async login(email: string, password: string, ctx: ClientCtx): Promise<LoginResponse> {
    const user = await this.prisma.staffUser.findUnique({ where: { email } });
    const deviceHash = this.deviceHash(ctx);
    const log = (outcome: LoginOutcome, userId?: string) =>
      this.prisma.loginEvent.create({ data: { userId, email, ip: ctx.ip, userAgent: ctx.userAgent, deviceHash, outcome } });

    if (!user) {
      await this.passwords.verifyDummy(password);
      await log('UNKNOWN_USER');
      await this.audit.record({ actorId: null, action: 'auth.login_failed', resourceType: 'Session', outcome: 'FAILURE', metadata: { reason: 'unknown_user' }, ip: ctx.ip, userAgent: ctx.userAgent });
      throw new UnauthorizedException({ message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    const locked = user.lockedUntil && user.lockedUntil > new Date();
    if (!ok) {
      if (!locked) await this.registerFailure(user.id, user.email, user.failedLoginCount, ctx, 'BAD_PASSWORD');
      await log('BAD_PASSWORD', user.id);
      throw new UnauthorizedException({ message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }
    if (user.status === 'DISABLED') {
      await log('DISABLED', user.id);
      throw new UnauthorizedException({ message: 'This account has been deactivated. Contact your administrator.', code: 'ACCOUNT_DISABLED' });
    }
    if (locked) {
      await log('LOCKED', user.id);
      throw new HttpException(
        { statusCode: 423, message: `Account locked until ${user.lockedUntil!.toISOString()}. Contact your administrator or try again later.`, code: 'ACCOUNT_LOCKED' },
        423,
      );
    }
    await log('PASSWORD_OK_TOTP_PENDING', user.id);
    return {
      status: user.totpEnabled ? 'TOTP_REQUIRED' : 'TOTP_ENROLL_REQUIRED',
      challengeToken: this.tokens.sign({ uid: user.id, purpose: '2fa' }, CHALLENGE_TTL),
    };
  }

  private async registerFailure(userId: string, email: string, current: number, ctx: ClientCtx, outcome: LoginOutcome) {
    const count = current + 1;
    const lock = count >= this.env.MAX_FAILED_LOGINS;
    await this.prisma.staffUser.update({
      where: { id: userId },
      data: { failedLoginCount: lock ? 0 : count, ...(lock ? { lockedUntil: new Date(Date.now() + this.env.LOCKOUT_MINUTES * 60_000) } : {}) },
    });
    await this.audit.record({
      actorId: userId, actorEmail: email, action: lock ? 'auth.account_locked' : 'auth.login_failed', resourceType: 'StaffUser', resourceId: userId,
      outcome: 'FAILURE', metadata: { reason: outcome, attempts: count }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
  }

  private challengeUser(token: string) {
    const p = this.tokens.verify<{ uid: string; purpose: string }>(token);
    if (!p || p.purpose !== '2fa') throw new UnauthorizedException({ message: 'Sign-in step expired. Start again.', code: 'CHALLENGE_EXPIRED' });
    return this.prisma.staffUser.findUniqueOrThrow({ where: { id: p.uid } });
  }

  /* ───── step 2a: enrolment (first login) ───── */
  async enrollStart(challengeToken: string): Promise<TotpEnrollResponse> {
    const user = await this.challengeUser(challengeToken);
    if (user.totpEnabled) throw new BadRequestException({ message: '2FA is already set up for this account', code: 'TOTP_ALREADY_ENROLLED' });
    const secret = authenticator.generateSecret();
    await this.prisma.staffUser.update({ where: { id: user.id }, data: { totpSecretEnc: this.cipher.encrypt(secret, `totp:${user.id}`) } });
    const otpauthUrl = authenticator.keyuri(user.email, this.env.TOTP_ISSUER, secret);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
  }

  /* ───── step 2b: verify code, create session ───── */
  async verifyTotp(challengeToken: string, code: string, ctx: ClientCtx): Promise<{ user: AuthUser; sessionToken: string; csrf: string; expiresAt: Date }> {
    const user = await this.challengeUser(challengeToken);
    if (user.status === 'DISABLED') throw new UnauthorizedException({ message: 'Account deactivated', code: 'ACCOUNT_DISABLED' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException({ statusCode: 423, message: 'Account locked. Try again later.', code: 'ACCOUNT_LOCKED' }, 423);
    }
    if (!user.totpSecretEnc) throw new BadRequestException({ message: 'Start 2FA enrolment first', code: 'TOTP_NOT_ENROLLED' });
    const secret = this.cipher.decrypt(user.totpSecretEnc, `totp:${user.id}`);
    const delta = authenticator.checkDelta(code, secret);
    const step = delta === null ? null : Math.floor(Date.now() / 30_000) + delta;
    // reject replays of an already-used code
    if (delta === null || (user.lastTotpStep !== null && step! <= user.lastTotpStep)) {
      await this.registerFailure(user.id, user.email, user.failedLoginCount, ctx, 'BAD_TOTP');
      await this.prisma.loginEvent.create({ data: { userId: user.id, email: user.email, ip: ctx.ip, userAgent: ctx.userAgent, deviceHash: this.deviceHash(ctx), outcome: 'BAD_TOTP' } });
      throw new UnauthorizedException({ message: 'Invalid or expired code', code: 'INVALID_TOTP' });
    }
    const firstTime = !user.totpEnabled;
    await this.prisma.staffUser.update({
      where: { id: user.id },
      data: { totpEnabled: true, failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ctx.ip, lastTotpStep: step },
    });
    if (firstTime) await this.audit.record({ actorId: user.id, actorEmail: user.email, actorName: user.fullName, action: 'auth.totp_enrolled', resourceType: 'StaffUser', resourceId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });

    const sessionToken = this.tokens.random(32);
    const now = Date.now();
    const expiresAt = new Date(now + this.env.SESSION_ABSOLUTE_SECONDS * 1000);
    const session = await this.prisma.session.create({
      data: { userId: user.id, tokenHash: this.tokens.sha256(sessionToken), ip: ctx.ip, userAgent: ctx.userAgent, deviceHash: this.deviceHash(ctx), expiresAt },
    });
    await this.prisma.loginEvent.create({ data: { userId: user.id, email: user.email, ip: ctx.ip, userAgent: ctx.userAgent, deviceHash: this.deviceHash(ctx), outcome: 'SUCCESS' } });
    const authUser = await this.loadAuthUser(user.id, session.id);
    await this.audit.record({
      actorId: user.id, actorEmail: user.email, actorName: user.fullName, actorRole: authUser.roleName, branchId: user.branchId,
      action: 'auth.login', resourceType: 'Session', resourceId: session.id, ip: ctx.ip, userAgent: ctx.userAgent,
      metadata: { device: describeDevice(ctx.userAgent) },
    });
    return { user: authUser, sessionToken, csrf: this.tokens.random(24), expiresAt };
  }

  /* ───── session helpers ───── */
  deviceHash(ctx: ClientCtx): string {
    return createHash('sha256').update(ctx.userAgent ?? 'unknown').digest('hex').slice(0, 16);
  }

  async loadAuthUser(userId: string, sessionId: string): Promise<AuthUser> {
    const u = await this.prisma.staffUser.findUniqueOrThrow({
      where: { id: userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    return {
      id: u.id, email: u.email, fullName: u.fullName, roleId: u.roleId, roleKey: u.role.key, roleName: u.role.name,
      branchId: u.branchId, allBranches: u.allBranches, branchScoped: u.role.branchScoped,
      permissions: new Set(u.role.permissions.map((p) => p.permission.key)), sessionId,
    };
  }

  /** Resolve a session cookie; returns null when invalid/expired/idle. Optionally extends the idle window. */
  async resolveSession(token: string, touch: boolean): Promise<AuthUser | null> {
    const s = await this.prisma.session.findUnique({
      where: { tokenHash: this.tokens.sha256(token) },
      include: { user: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!s || s.revokedAt) return null;
    const now = Date.now();
    if (s.expiresAt.getTime() <= now) return null;
    if (s.lastActiveAt.getTime() + this.env.SESSION_IDLE_SECONDS * 1000 <= now) {
      await this.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedReason: 'idle_timeout' } });
      return null;
    }
    if (s.user.status !== 'ACTIVE') return null;
    if (touch && now - s.lastActiveAt.getTime() > 15_000) {
      await this.prisma.session.update({ where: { id: s.id }, data: { lastActiveAt: new Date() } });
    }
    const u = s.user;
    return {
      id: u.id, email: u.email, fullName: u.fullName, roleId: u.roleId, roleKey: u.role.key, roleName: u.role.name,
      branchId: u.branchId, allBranches: u.allBranches, branchScoped: u.role.branchScoped,
      permissions: new Set(u.role.permissions.map((p) => p.permission.key)), sessionId: s.id,
    };
  }

  async me(user: AuthUser): Promise<Me> {
    const [u, session, unread] = await Promise.all([
      this.prisma.staffUser.findUniqueOrThrow({ where: { id: user.id }, include: { role: true, branch: true } }),
      this.prisma.session.findUniqueOrThrow({ where: { id: user.sessionId } }),
      this.prisma.inAppNotification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const idleExpiry = session.lastActiveAt.getTime() + this.env.SESSION_IDLE_SECONDS * 1000;
    return {
      id: u.id, email: u.email, fullName: u.fullName,
      role: { id: u.role.id, key: u.role.key, name: u.role.name },
      branch: u.branch ? { id: u.branch.id, code: u.branch.code, name: u.branch.name } : null,
      allBranches: u.allBranches, permissions: [...user.permissions].sort(), totpEnabled: u.totpEnabled,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      sessionExpiresAt: new Date(Math.min(idleExpiry, session.expiresAt.getTime())).toISOString(),
      idleTimeoutSeconds: this.env.SESSION_IDLE_SECONDS, unreadNotifications: unread,
    };
  }

  async logout(user: AuthUser): Promise<void> {
    await this.prisma.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date(), revokedReason: 'logout' } });
    await this.audit.record({ action: 'auth.logout', resourceType: 'Session', resourceId: user.sessionId });
  }

  async sessions(user: AuthUser): Promise<SessionDto[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() }, lastActiveAt: { gt: new Date(Date.now() - this.env.SESSION_IDLE_SECONDS * 1000) } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id, ip: s.ip, userAgent: s.userAgent, device: describeDevice(s.userAgent),
      createdAt: s.createdAt.toISOString(), lastActiveAt: s.lastActiveAt.toISOString(), current: s.id === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    const s = await this.prisma.session.findFirst({ where: { id: sessionId, userId: user.id } });
    if (!s) throw new NotFoundException('Session not found');
    await this.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' } });
    await this.audit.record({ action: 'auth.session_revoked', resourceType: 'Session', resourceId: s.id });
  }

  async revokeAllForUser(userId: string, reason: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async changePassword(user: AuthUser, current: string, next: string): Promise<void> {
    const u = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(u.passwordHash, current))) throw new BadRequestException({ message: 'Current password is incorrect', code: 'BAD_PASSWORD' });
    await this.prisma.staffUser.update({ where: { id: u.id }, data: { passwordHash: await this.passwords.hash(next), passwordChangedAt: new Date(), mustChangePassword: false } });
    await this.prisma.session.updateMany({ where: { userId: u.id, id: { not: user.sessionId }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'password_changed' } });
    await this.audit.record({ action: 'auth.password_changed', resourceType: 'StaffUser', resourceId: u.id });
  }

  /** DEMO ONLY: current TOTP code for a seeded user. Disabled unless DEMO_MODE and not production. */
  async demoTotp(email: string): Promise<{ code: string; expiresInSeconds: number }> {
    if (!this.env.DEMO_MODE || this.env.NODE_ENV === 'production') throw new NotFoundException();
    const u = await this.prisma.staffUser.findUnique({ where: { email } });
    if (!u?.totpSecretEnc) throw new NotFoundException();
    const secret = this.cipher.decrypt(u.totpSecretEnc, `totp:${u.id}`);
    return { code: authenticator.generate(secret), expiresInSeconds: authenticator.timeRemaining() };
  }
}
