// src/app/api/auth/send-verification/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';
import {
  buildActionCodeSettings,
  normalizeLocale,
  resolveDestination,
} from '@/lib/auth/actionLinks';
import { siteConfig } from '@/config/site';
import { isCustomMailerConfigured, sendTransactionalEmail } from '@/lib/email/mailer';
import { buildVerificationEmail } from '@/lib/email/verificationTemplate';

export const dynamic = 'force-dynamic';

const MAX_EMAILS_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  const uid = await verifyRequestUser(request);
  if (!uid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!takeRateLimit(`verify-email:${uid}`, MAX_EMAILS_PER_WINDOW, WINDOW_MS)) {
    return NextResponse.json(
      { error: 'too-many-requests', message: 'Já enviamos um e-mail há pouco. Confira a caixa de entrada e o spam.' },
      { status: 429 },
    );
  }

  if (!isCustomMailerConfigured()) {
    return NextResponse.json({ sent: false, reason: 'smtp-not-configured' });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      locale?: string;
      destination?: string;
    };
    const locale = normalizeLocale(body.locale);
    const destination = resolveDestination(body.destination);

    const auth = adminAuth();
    const userRecord = await auth.getUser(uid);
    if (!userRecord.email) {
      return NextResponse.json({ error: 'missing-email' }, { status: 400 });
    }
    if (userRecord.emailVerified) {
      return NextResponse.json({ sent: false, alreadyVerified: true });
    }

    const actionSettings = buildActionCodeSettings(locale, destination, siteConfig.officialOrigin);
    const verificationLink = await auth.generateEmailVerificationLink(userRecord.email, actionSettings);
    const message = buildVerificationEmail({
      locale,
      displayName: userRecord.displayName,
      verificationLink,
    });

    const result = await sendTransactionalEmail({
      to: userRecord.email,
      ...message,
    });

    return NextResponse.json({
      sent: true,
      provider: 'custom-smtp',
      from: result.from,
    });
  } catch (error) {
    console.error('[send-verification] Falha ao enviar e-mail próprio:', error);
    return NextResponse.json({ sent: false, reason: 'smtp-send-failed' }, { status: 500 });
  }
}
