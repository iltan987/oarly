import { Resend, type CreateEmailOptions } from 'resend';
import { env } from '@/env';

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: { filename: string; content: string | Buffer }[];
};

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log('[email:dev]', { to: input.to, subject: input.subject });
    return;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  // Resend's CreateEmailOptions is a content-field union; our sendEmail guarantees html or text at call sites.
  const payload = {
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html ?? undefined,
    text: input.text ?? undefined,
    attachments: input.attachments,
  } as CreateEmailOptions;
  await resend.emails.send(payload);
}
