import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class NotificationEmailService {
  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.apiKey && this.sender);
  }

  async send(input: { notificationId: string; to: string; subject: string; message: string }) {
    if (!this.apiKey || !this.sender) throw new Error('Provedor de e-mail n\u00e3o configurado');
    const { data, error } = await new Resend(this.apiKey).emails.send(
      {
        from: this.sender,
        to: input.to,
        subject: input.subject,
        html: this.toHtml(input.message),
      },
      { headers: { 'Idempotency-Key': `notification-${input.notificationId}` } },
    );
    if (error || !data?.id) throw new Error(error?.message || 'O provedor recusou o envio');
    return data.id;
  }

  private get apiKey() { return this.config.get<string>('RESEND_API_KEY'); }
  private get sender() {
    return this.config.get<string>('NOTIFICATION_FROM_EMAIL') ?? this.config.get<string>('COLLECTION_FROM_EMAIL');
  }

  private toHtml(message: string) {
    const escaped = message
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
      .replaceAll('\n', '<br>');
    return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">${escaped}</div>`;
  }
}
