import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface CollectionEmailInput {
  dispatchId: string;
  recipient: string;
  subject: string;
  message: string;
}

@Injectable()
export class CollectionEmailService {
  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(
      this.config.get<string>('RESEND_API_KEY') &&
      this.config.get<string>('COLLECTION_FROM_EMAIL'),
    );
  }

  async send(input: CollectionEmailInput): Promise<string> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('COLLECTION_FROM_EMAIL');
    if (!apiKey || !from) {
      throw new Error('Provedor de e-mail não configurado');
    }

    const { data, error } = await new Resend(apiKey).emails.send(
      {
        from,
        to: input.recipient,
        subject: input.subject,
        html: this.toHtml(input.message),
      },
      { headers: { 'Idempotency-Key': `collection-${input.dispatchId}` } },
    );
    if (error || !data?.id) {
      throw new Error(error?.message || 'O provedor recusou o envio');
    }
    return data.id;
  }

  private toHtml(message: string): string {
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
