// src/app/feed.json/route.ts
import { siteConfig } from '@/config/site';
import { getLocalNetworkFeedItems, renderJsonFeed } from '@/lib/server/syndication';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = siteConfig.baseUrl.replace(/\/+$/, '');
  const items = await getLocalNetworkFeedItems(30);
  const body = renderJsonFeed({
    title: `${siteConfig.name} — Nossa Rede`,
    description: siteConfig.description,
    homeUrl: `${base}/pt-BR`,
    feedUrl: `${base}/feed.json`,
    items,
  });

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/feed+json; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

