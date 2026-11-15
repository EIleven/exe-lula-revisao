import { NextResponse } from 'next/server';
import { getBlueskyOAuthClient } from '@/lib/server/blueskyOAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = await getBlueskyOAuthClient();
    return NextResponse.json(client.jwks, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch {
    return NextResponse.json({ message: 'Bluesky OAuth ainda não está disponível.' }, { status: 503 });
  }
}
