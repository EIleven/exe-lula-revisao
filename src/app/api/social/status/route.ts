import { NextResponse } from 'next/server';
import { verifyRequestUser } from '@/lib/server/requestAuth';
import { getConnection } from '@/lib/server/socialStore';
import { blueskyConfigured } from '@/lib/server/socialConfig';
import type { SocialConnectionSummary } from '@/lib/social/types';

export const dynamic = 'force-dynamic';

const summary = (connection: Awaited<ReturnType<typeof getConnection>>): SocialConnectionSummary => connection ? {
  connected: true,
  handle: connection.handle,
  displayName: connection.displayName,
  avatarUrl: connection.avatarUrl,
  connectedAt: connection.connectedAt,
} : { connected: false };

export async function GET(request: Request) {
  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ message: 'Entre na sua conta para gerenciar conexões.' }, { status: 401 });
  const bluesky = await getConnection(uid, 'bluesky');
  return NextResponse.json({
    providers: {
      bluesky: { configured: blueskyConfigured(), connection: summary(bluesky) },
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
