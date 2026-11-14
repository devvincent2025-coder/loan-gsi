import { Logger } from '@nestjs/common';
import type { NotificationChannel } from '@damez/shared';

export interface OutboundMessage {
  to: string;
  subject?: string | null;
  body: string;
}
export interface SendResult { providerMessageId: string }

/** Provider adapter contract. One mock + live stubs per channel; selected by env. */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  readonly name: string;
  send(msg: OutboundMessage): Promise<SendResult>;
}

const mockLog = new Logger('MockProvider');
let counter = 0;
const mockId = (p: string) => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** Mock: never leaves the process. Numbers ending in 0000 simulate a provider failure (for testing retries). */
export class MockProvider implements NotificationProvider {
  constructor(readonly channel: NotificationChannel, readonly name = 'mock') {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (msg.to.endsWith('0000')) throw new Error('MockProvider: simulated delivery failure');
    mockLog.debug(`[${this.channel}] -> ${msg.to.slice(0, 4)}•••• (${msg.body.length} chars)`);
    return { providerMessageId: mockId(this.channel.toLowerCase()) };
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

/** LIVE STUB. TODO: set TERMII_API_KEY, confirm sender-ID registration with NCC DND rules; add delivery webhook. */
export class TermiiSmsProvider implements NotificationProvider {
  readonly channel = 'SMS' as const;
  readonly name = 'termii';
  constructor(private apiKey?: string, private senderId = 'Damez') {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.apiKey) throw new Error('TERMII_API_KEY is not configured');
    const r = (await postJson('https://api.ng.termii.com/api/sms/send', {
      api_key: this.apiKey, to: msg.to.replace(/^\+/, ''), from: this.senderId, sms: msg.body, type: 'plain', channel: 'generic',
    })) as { message_id?: string };
    return { providerMessageId: r.message_id ?? 'termii-unknown' };
  }
}

/** LIVE STUB. TODO: AT_USERNAME / AT_API_KEY / AT_SENDER_ID; use sandbox host for tests. */
export class AfricasTalkingSmsProvider implements NotificationProvider {
  readonly channel = 'SMS' as const;
  readonly name = 'africastalking';
  constructor(private username?: string, private apiKey?: string, private from?: string) {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.username || !this.apiKey) throw new Error('Africa\'s Talking credentials are not configured');
    const form = new URLSearchParams({ username: this.username, to: msg.to, message: msg.body, ...(this.from ? { from: this.from } : {}) });
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST', headers: { apiKey: this.apiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: form,
    });
    if (!res.ok) throw new Error(`AT HTTP ${res.status}`);
    const j = (await res.json()) as { SMSMessageData?: { Recipients?: Array<{ messageId?: string }> } };
    return { providerMessageId: j.SMSMessageData?.Recipients?.[0]?.messageId ?? 'at-unknown' };
  }
}

/** LIVE STUB. TODO: RESEND_API_KEY + verified sending domain (SPF/DKIM). Swap for SMTP/SES if preferred. */
export class ResendEmailProvider implements NotificationProvider {
  readonly channel = 'EMAIL' as const;
  readonly name = 'resend';
  constructor(private apiKey?: string, private from = 'Damez Loan <no-reply@damez.ng>') {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.apiKey) throw new Error('RESEND_API_KEY is not configured');
    const r = (await postJson('https://api.resend.com/emails', { from: this.from, to: [msg.to], subject: msg.subject ?? '(no subject)', text: msg.body }, { authorization: `Bearer ${this.apiKey}` })) as { id?: string };
    return { providerMessageId: r.id ?? 'resend-unknown' };
  }
}

/** LIVE STUB. TODO: Meta WhatsApp Cloud API: approved template messages are required outside the 24h window. */
export class MetaWhatsAppProvider implements NotificationProvider {
  readonly channel = 'WHATSAPP' as const;
  readonly name = 'meta';
  constructor(private token?: string, private phoneId?: string) {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.token || !this.phoneId) throw new Error('META_WHATSAPP_TOKEN / META_WHATSAPP_PHONE_ID not configured');
    const r = (await postJson(`https://graph.facebook.com/v20.0/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp', to: msg.to.replace(/^\+/, ''), type: 'text', text: { body: msg.body },
    }, { authorization: `Bearer ${this.token}` })) as { messages?: Array<{ id: string }> };
    return { providerMessageId: r.messages?.[0]?.id ?? 'meta-unknown' };
  }
}

/** LIVE STUB. TODO: Termii WhatsApp channel ("whatsapp" / dnd) via the same /sms/send endpoint. */
export class TermiiWhatsAppProvider implements NotificationProvider {
  readonly channel = 'WHATSAPP' as const;
  readonly name = 'termii-whatsapp';
  constructor(private apiKey?: string, private senderId = 'Damez') {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.apiKey) throw new Error('TERMII_API_KEY is not configured');
    const r = (await postJson('https://api.ng.termii.com/api/sms/send', {
      api_key: this.apiKey, to: msg.to.replace(/^\+/, ''), from: this.senderId, sms: msg.body, type: 'plain', channel: 'whatsapp',
    })) as { message_id?: string };
    return { providerMessageId: r.message_id ?? 'termii-wa-unknown' };
  }
}
