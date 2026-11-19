// src/lib/email/mailer.ts
// Camada própria de envio de e-mails transacionais via SMTP (sem dependência de provedor fechado).
import nodemailer from 'nodemailer';
import { siteConfig } from '@/config/site';

export const DEFAULT_BRAND_FROM = 'HiperVerso <HiperVerso@hiperverso.app>';

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  replyTo: string;
}

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const from = process.env.SMTP_FROM?.trim() || DEFAULT_BRAND_FROM;
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || siteConfig.contact.support;

  return { host, port, secure, user, pass, from, replyTo };
}

export function isCustomMailerConfigured(): boolean {
  return readSmtpConfig() !== null;
}

export interface TransactionalEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<{ messageId: string; from: string }> {
  const cfg = readSmtpConfig();
  if (!cfg) {
    throw new Error('SMTP não configurado neste ambiente.');
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  const info = await transporter.sendMail({
    from: cfg.from,
    to: input.to,
    replyTo: cfg.replyTo,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: {
      'X-Auto-Response-Suppress': 'OOF, AutoReply',
      'X-Entity-Ref-ID': `hv-${Date.now().toString(36)}`,
    },
  });

  return {
    messageId: info.messageId,
    from: cfg.from,
  };
}
