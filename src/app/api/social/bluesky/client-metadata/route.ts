import { NextResponse } from 'next/server';
import { blueskyClientMetadata } from '@/lib/server/blueskyOAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(blueskyClientMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
  });
}
