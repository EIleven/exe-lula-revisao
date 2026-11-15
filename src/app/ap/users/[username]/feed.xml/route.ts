// src/app/ap/users/[username]/feed.xml/route.ts
import type { NextRequest } from 'next/server';
import { normalizeHandle } from '@/lib/activitypub/identity';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { federation } from '@/lib/server/federation';
import { getUserFeedItems, renderRssXml } from '@/lib/server/syndication';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ username: string }> }) {
  const { username: rawHandle } = await context.params;
  const handle = normalizeHandle(rawHandle);
  if (!handle) return new Response(null, { status: 404 });

  const f = federation();
  const reserva = await f.store.getHandle(handle);
  if (!reserva || reserva.state !== 'active') return new Response(null, { status: 404 });

  const userSnap = await adminFirestore().collection('users').doc(reserva.uid).get();
  const userData = userSnap.data();
  if (!userSnap.exists || userData?.profileVisibility === 'private') return new Response(null, { status: 404 });

  const items = await getUserFeedItems(reserva.uid, 30);
  const xml = renderRssXml({
    title: `${typeof userData?.name === 'string' && userData.name ? userData.name : `@${handle}`} (@${handle}@${f.ownHost})`,
    description: typeof userData?.bio === 'string' && userData.bio ? userData.bio : `Publicações de @${handle}@${f.ownHost}`,
    link: `${f.origin}/pt-BR/profile/${encodeURIComponent(reserva.uid)}`,
    selfUrl: `${f.origin}/ap/users/${encodeURIComponent(handle)}/feed.xml`,
    items,
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

