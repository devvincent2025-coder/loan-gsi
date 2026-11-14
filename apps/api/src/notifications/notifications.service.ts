import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationChannel as DbChannel } from '@prisma/client';
import { defaultRedactor, maskEmail, maskPhone, NotificationChannel } from '@damez/shared';
import { APP_ENV, AppEnv } from '../config/config.module';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import {
  AfricasTalkingSmsProvider, MetaWhatsAppProvider, MockProvider, NotificationProvider, ResendEmailProvider,
  TermiiSmsProvider, TermiiWhatsAppProvider,
} from './providers';

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

export interface SendArgs {
  channel: NotificationChannel;
  /** phone / email / userId (for IN_APP) */
  to: string;
  templateKey: string;
  variables?: Record<string, string>;
  href?: string;
}

interface DeliverJob { deliveryId: string; toEnc: string; subject: string | null; body: string; channel: NotificationChannel }

@Injectable()
export class NotificationsService implements OnModuleInit {
  private providers: Record<'SMS' | 'EMAIL' | 'WHATSAPP', NotificationProvider>;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    private prisma: PrismaService,
    private queue: QueueService,
    private cipher: FieldCipher,
  ) {
    this.providers = {
      SMS: env.SMS_PROVIDER === 'termii' ? new TermiiSmsProvider(env.TERMII_API_KEY, env.TERMII_SENDER_ID)
        : env.SMS_PROVIDER === 'africastalking' ? new AfricasTalkingSmsProvider(env.AT_USERNAME, env.AT_API_KEY, env.AT_SENDER_ID)
        : new MockProvider('SMS'),
      EMAIL: env.EMAIL_PROVIDER === 'resend' ? new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM) : new MockProvider('EMAIL'),
      WHATSAPP: env.WHATSAPP_PROVIDER === 'meta' ? new MetaWhatsAppProvider(env.META_WHATSAPP_TOKEN, env.META_WHATSAPP_PHONE_ID)
        : env.WHATSAPP_PROVIDER === 'termii' ? new TermiiWhatsAppProvider(env.TERMII_API_KEY, env.TERMII_SENDER_ID)
        : new MockProvider('WHATSAPP'),
    };
  }

  providerName(channel: 'SMS' | 'EMAIL' | 'WHATSAPP'): string { return this.providers[channel].name; }

  onModuleInit(): void {
    this.queue.register(QUEUES.notifications, (name, data) => (name === 'deliver' ? this.deliver(data as DeliverJob) : Promise.resolve()));
  }

  private mask(channel: NotificationChannel, to: string): string {
    return channel === 'EMAIL' ? maskEmail(to) : maskPhone(to);
  }

  /** Render a template and send. IN_APP writes directly; external channels are queued (recipient encrypted in the job payload). */
  async send(args: SendArgs): Promise<{ deliveryId?: string; inAppId?: string }> {
    const tpl = await this.prisma.notificationTemplate.findUnique({ where: { key_channel: { key: args.templateKey, channel: args.channel as DbChannel } } });
    if (!tpl || !tpl.isActive) throw new Error(`No active ${args.channel} template "${args.templateKey}"`);
    const vars = args.variables ?? {};
    const body = renderTemplate(tpl.body, vars);
    const subject = tpl.subject ? renderTemplate(tpl.subject, vars) : null;

    if (args.channel === 'IN_APP') {
      const n = await this.prisma.inAppNotification.create({ data: { userId: args.to, title: subject ?? tpl.name, body, href: args.href ?? null } });
      return { inAppId: n.id };
    }
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        channel: args.channel as DbChannel, provider: this.providers[args.channel].name, recipientMasked: this.mask(args.channel, args.to),
        recipientHash: this.cipher.blindIndex(args.to, 'notify'), templateKey: args.templateKey, bodyRedacted: defaultRedactor.scrubString(body),
      },
    });
    const job: DeliverJob = { deliveryId: delivery.id, toEnc: this.cipher.encrypt(args.to, 'notify'), subject, body, channel: args.channel };
    try {
      await this.queue.enqueue(QUEUES.notifications, 'deliver', job);
    } catch (e) {
      await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', error: (e as Error).message } });
    }
    return { deliveryId: delivery.id };
  }

  /** In-app only convenience for notifying staff. */
  async notifyUsers(userIds: string[], title: string, body: string, href?: string): Promise<void> {
    if (!userIds.length) return;
    await this.prisma.inAppNotification.createMany({ data: userIds.map((userId) => ({ userId, title, body, href: href ?? null })) });
  }

  /** Worker body (BullMQ or inline). Throws on failure so BullMQ retries; the final failure is recorded. */
  async deliver(job: DeliverJob): Promise<void> {
    const to = this.cipher.decrypt(job.toEnc, 'notify');
    const provider = this.providers[job.channel as 'SMS' | 'EMAIL' | 'WHATSAPP'];
    await this.prisma.notificationDelivery.update({ where: { id: job.deliveryId }, data: { attempts: { increment: 1 } } });
    try {
      const r = await provider.send({ to, subject: job.subject, body: job.body });
      await this.prisma.notificationDelivery.update({ where: { id: job.deliveryId }, data: { status: 'SENT', sentAt: new Date(), providerMessageId: r.providerMessageId, error: null } });
    } catch (e) {
      await this.prisma.notificationDelivery.update({ where: { id: job.deliveryId }, data: { status: 'FAILED', error: defaultRedactor.scrubString((e as Error).message).slice(0, 500) } });
      throw e;
    }
  }
}
