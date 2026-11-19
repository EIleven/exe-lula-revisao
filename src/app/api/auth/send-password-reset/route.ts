// src/app/api/auth/send-password-reset/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { buildActionCodeSettings, normalizeLocale } from '@/lib/auth/actionLinks';
import { siteConfig } from '@/config/site';
import { isCustomMailerConfigured, sendTransactionalEmail } from '@/lib/email/mailer';
import { buildPasswordResetEmail } from '@/lib/email/verificationTemplate';

export const dynamic = 'force-dynamic';

const MAX_RESETS_PER_IP = 8;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/auth/send-password-reset',
    method: 'POST',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
  });
  if (!guard.allowed && guard.action === 'block') {
    return NextResponse.json(
      { error: 'too-many-requests', message: 'Muitas tentativas. Tente de novo mais tarde.' },
      { status: 429, headers: { 'Retry-After': String(guard.retryAfterSec || 30) } },
    );
  }

  if (!takeRateLimit(`pw-reset:${ip}`, MAX_RESETS_PER_IP, WINDOW_MS)) {
    return NextResponse.json(
      { error: 'too-many-requests', message: 'Muitas tentativas. Tente de novo mais tarde.' },
      { status: 429 },
    );
  }

  if (!isCustomMailerConfigured()) {
    return NextResponse.json({ sent: false, reason: 'smtp-not-configured' });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      locale?: string;
    };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'invalid-email', message: 'E-mail inválido.' }, { status: 400 });
    }

    const locale = normalizeLocale(body.locale);
    const auth = adminAuth();

    let displayName: string | undefined;
    try {
      const userRecord = await auth.getUserByEmail(email);
      displayName = userRecord.displayName;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      // Nunca revela se o e-mail existe na rede.
      if (code === 'auth/user-not-found') {
        return NextResponse.json({ sent: true, provider: 'custom-smtp' });
      }
      throw err;
    }

    const actionSettings = buildActionCodeSettings(locale, 'login', siteConfig.officialOrigin);
    const resetLink = await auth.generatePasswordResetLink(email, actionSettings);
    const message = buildPasswordResetEmail({
      locale,
      displayName,
      resetLink,
    });

    await sendTransactionalEmail({
      to: email,
      ...message,
    });

    return NextResponse.json({ sent: true, provider: 'custom-smtp' });
  } catch (error) {
    console.error('[send-password-reset] Falha ao enviar e-mail próprio:', error);
    return NextResponse.json({ sent: false, reason: 'smtp-send-failed' }, { status: 500 });
  }
}
