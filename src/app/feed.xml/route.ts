// src/app/feed.xml/route.ts
import { siteConfig } from '@/config/site';
import { getLocalNetworkFeedItems, renderRssXml } from '@/lib/server/syndication';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = siteConfig.baseUrl.replace(/\/+$/, '');
  const items = await getLocalNetworkFeedItems(30);
  const xml = renderRssXml({
    title: `${siteConfig.name} — Nossa Rede`,
    description: siteConfig.description,
    link: `${base}/pt-BR`,
    selfUrl: `${base}/feed.xml`,
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

