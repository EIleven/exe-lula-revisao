
// src/app/api/revalidate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
const SECRET = process.env.REVALIDATE_SECRET;
const locales = ['pt-BR', 'en']; // The same locales from your i18n config

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const secret = searchParams.get('secret');
  const path = searchParams.get('path');

  if (secret !== SECRET) {
    return NextResponse.json({ message: 'Invalid secret token' }, { status: 401 });
  }

  if (!path) {
    return NextResponse.json({ message: 'Missing path parameter' }, { status: 400 });
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
