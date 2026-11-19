
// src/app/api/revalidate/route.ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';
const SECRET = process.env.REVALIDATE_SECRET;
const locales = ['pt-BR', 'en']; // The same locales from your i18n config

function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const ip = requestIp(request);
  const { searchParams } = request.nextUrl;
  const secret = searchParams.get('secret');
  const path = searchParams.get('path');

  if (!secretMatches(secret, SECRET)) {
    if (!takeRateLimit(`revalidate-fail:${ip}`, 10, 60_000)) {
      return NextResponse.json({ message: 'Too many requests' }, { status: 429 });
    }
    return NextResponse.json({ message: 'Invalid secret token' }, { status: 401 });
  }

  if (!path || !path.startsWith('/') || path.length > 300) {
    return NextResponse.json({ message: 'Missing or invalid path parameter' }, { status: 400 });
  }

  try {
    // Check if the path is a dynamic, localized route
    if (path.startsWith('/post/') || path.startsWith('/profile/')) {
      // Revalidate the path for each supported locale
      locales.forEach(locale => {
        const localizedPath = `/${locale}${path}`;
        console.log(`Revalidating path: ${localizedPath}`);
        revalidatePath(localizedPath);
      });
    } else {
      // For general paths like '/sitemap.xml', revalidate directly
      console.log(`Revalidating path: ${path}`);
      revalidatePath(path);
    }
    
    return NextResponse.json({ revalidated: true, path, now: Date.now() });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message: 'Error revalidating', error }, { status: 500 });
  }
}
