// src/lib/email/verificationTemplate.ts
// Template transacional limpo (HTML + texto puro) para minimizar classificação em spam.
import type { SupportedLocale } from '@/lib/auth/actionLinks';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildVerificationEmail(params: {
  locale: SupportedLocale;
  displayName?: string | null;
  verificationLink: string;
}): { subject: string; text: string; html: string } {
  const { locale, displayName, verificationLink } = params;
  const greetingName = displayName?.trim() ? `, ${displayName.trim()}` : '';
  const safeName = displayName?.trim() ? `, ${escapeHtml(displayName.trim())}` : '';
  const safeLink = escapeHtml(verificationLink);

  if (locale === 'en') {
    const subject = 'Confirm your email on HiperVerso';
    const text = [
      `Hello${greetingName},`,
      '',
      'Please confirm your email address to activate your account on HiperVerso:',
      verificationLink,
      '',
      'If you did not request this confirmation, you can safely ignore this message.',
      '',
      'HiperVerso · HiperVerso@hiperverso.app',
    ].join('\n');

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#0f1115;color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;margin:0 auto;background:#161922;border:1px solid #262b38;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid #262b38;">
      <strong style="font-size:18px;letter-spacing:-0.01em;color:#ffffff;">HiperVerso</strong>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#ffffff;">Confirm your email address</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#d1d5db;">Hello${safeName}, click the button below to confirm your email and unlock all network features.</p>
      <p style="margin:24px 0;">
        <a href="${safeLink}" style="display:inline-block;padding:12px 22px;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">Confirm email</a>
      </p>
      <p style="margin:18px 0 6px;font-size:13px;color:#9ca3af;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#a5b4fc;">${safeLink}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">If you did not create an account on HiperVerso, you can ignore this message.</p>
    </td></tr>
  </table>
</body>
</html>`;
    return { subject, text, html };
  }

  const subject = 'Confirme seu e-mail no HiperVerso';
  const text = [
    `Olá${greetingName},`,
    '',
    'Confirme seu endereço de e-mail para ativar sua conta no HiperVerso:',
    verificationLink,
    '',
    'Se você não solicitou esta confirmação, basta ignorar esta mensagem.',
    '',
    'HiperVerso · HiperVerso@hiperverso.app',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#0f1115;color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;margin:0 auto;background:#161922;border:1px solid #262b38;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid #262b38;">
      <strong style="font-size:18px;letter-spacing:-0.01em;color:#ffffff;">HiperVerso</strong>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#ffffff;">Confirme seu endereço de e-mail</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#d1d5db;">Olá${safeName}, clique no botão abaixo para confirmar seu e-mail e liberar todos os recursos da rede.</p>
      <p style="margin:24px 0;">
        <a href="${safeLink}" style="display:inline-block;padding:12px 22px;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">Confirmar e-mail</a>
      </p>
      <p style="margin:18px 0 6px;font-size:13px;color:#9ca3af;">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#a5b4fc;">${safeLink}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Se você não solicitou esta confirmação no HiperVerso, pode ignorar este e-mail com segurança.</p>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

export function buildPasswordResetEmail(params: {
  locale: SupportedLocale;
  displayName?: string | null;
  resetLink: string;
}): { subject: string; text: string; html: string } {
  const { locale, displayName, resetLink } = params;
  const greetingName = displayName?.trim() ? `, ${displayName.trim()}` : '';
  const safeName = displayName?.trim() ? `, ${escapeHtml(displayName.trim())}` : '';
  const safeLink = escapeHtml(resetLink);

  if (locale === 'en') {
    const subject = 'Reset your password on HiperVerso';
    const text = [
      `Hello${greetingName},`,
      '',
      'We received a request to set a new password for your HiperVerso account:',
      resetLink,
      '',
      'If you did not ask for this, just ignore this message — your current password stays unchanged.',
      '',
      'HiperVerso · HiperVerso@hiperverso.app',
    ].join('\n');

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#0f1115;color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;margin:0 auto;background:#161922;border:1px solid #262b38;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid #262b38;">
      <strong style="font-size:18px;letter-spacing:-0.01em;color:#ffffff;">HiperVerso</strong>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#ffffff;">Create a new password</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#d1d5db;">Hello${safeName}, click below to choose a new password for your HiperVerso account.</p>
      <p style="margin:24px 0;">
        <a href="${safeLink}" style="display:inline-block;padding:12px 22px;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">Reset password</a>
      </p>
      <p style="margin:18px 0 6px;font-size:13px;color:#9ca3af;">If the button does not work, copy and paste this link:</p>
      <p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#a5b4fc;">${safeLink}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Didn't request this? You can ignore this email — your password won't change.</p>
    </td></tr>
  </table>
</body>
</html>`;
    return { subject, text, html };
  }

  const subject = 'Redefina sua senha no HiperVerso';
  const text = [
    `Olá${greetingName},`,
    '',
    'Recebemos um pedido para criar uma nova senha para sua conta no HiperVerso:',
    resetLink,
    '',
    'Se não foi você, basta ignorar esta mensagem — sua senha atual continua a mesma.',
    '',
    'HiperVerso · HiperVerso@hiperverso.app',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#0f1115;color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;margin:0 auto;background:#161922;border:1px solid #262b38;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid #262b38;">
      <strong style="font-size:18px;letter-spacing:-0.01em;color:#ffffff;">HiperVerso</strong>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#ffffff;">Criar nova senha</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#d1d5db;">Olá${safeName}, clique abaixo para escolher uma nova senha para a sua conta no HiperVerso.</p>
      <p style="margin:24px 0;">
        <a href="${safeLink}" style="display:inline-block;padding:12px 22px;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">Criar nova senha</a>
      </p>
      <p style="margin:18px 0 6px;font-size:13px;color:#9ca3af;">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#a5b4fc;">${safeLink}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Não pediu essa troca? Pode ignorar este e-mail — sua senha atual continua valendo.</p>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
