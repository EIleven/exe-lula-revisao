// src/lib/server/syndication.ts
// Feeds abertos (RSS 2.0 e JSON Feed 1.1) para leitores externos e protocolos da web aberta,
// com cache LRU em memória para que polling de leitores não gere leituras repetidas no Firestore.
import { LRUCache } from 'lru-cache';
import { siteConfig } from '@/config/site';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

export interface SyndicationItem {
  id: string;
  url: string;
  title: string;
  text: string;
  authorName: string;
  authorHandle?: string;
  publishedIso: string;
  imageUrl?: string | null;
}

const feedCache = new LRUCache<string, SyndicationItem[]>({
  max: 128,
  ttl: 3 * 60 * 1000,
});

const origin = () => siteConfig.baseUrl.replace(/\/+$/, '');

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(raw: unknown): string {
  if (!raw) return new Date().toISOString();
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
  }
  if (typeof (raw as { toMillis?: unknown }).toMillis === 'function') {
    return new Date((raw as { toMillis: () => number }).toMillis()).toISOString();
  }
  return new Date().toISOString();
}

function docToSyndicationItem(id: string, d: Record<string, unknown>): SyndicationItem | null {
  if (d.isDeleted === true) return null;
  const text = typeof d.text === 'string' && d.text.trim()
    ? d.text.trim()
    : (typeof d.headline === 'string' ? d.headline.trim() : '');
  if (!text) return null;

  const authorDetails = (d.authorDetails ?? {}) as { name?: unknown; username?: unknown };
  const authorName = typeof authorDetails.name === 'string' && authorDetails.name
    ? authorDetails.name
    : (typeof authorDetails.username === 'string' ? `@${authorDetails.username}` : 'HiperVerso');
  const authorHandle = typeof authorDetails.username === 'string' ? authorDetails.username : undefined;

  const mediaList = Array.isArray(d.media) ? d.media : [];
  const firstImage = mediaList.find(
    (m) => m && typeof m === 'object' && (m as { type?: unknown }).type === 'image' && typeof (m as { url?: unknown }).url === 'string',
  ) as { url?: string } | undefined;

  const headline = typeof d.headline === 'string' && d.headline.trim() ? d.headline.trim() : '';
  const title = headline || (text.length > 90 ? `${text.slice(0, 87)}...` : text);

  return {
    id,
    url: `${origin()}/pt-BR/post/${encodeURIComponent(id)}`,
    title,
    text,
    authorName,
    authorHandle,
    publishedIso: toIsoDate(d.createdAt),
    imageUrl: firstImage?.url ?? null,
  };
}

/** Últimos posts públicos locais da rede (equivalente à aba 🦑). */
export async function getLocalNetworkFeedItems(limit = 30): Promise<SyndicationItem[]> {
  const cacheKey = `local:${limit}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return cached;

  const db = adminFirestore();
  const snap = await db
    .collection('posts')
    .where('visibility', '==', 'public')
    .orderBy('createdAt', 'desc')
    .limit(120)
    .get();

  const items: SyndicationItem[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const userId = typeof d.userId === 'string' ? d.userId : '';
    if (!userId || userId.startsWith('ap_') || d.isRemoteFediverse === true) continue;
    if (d.type === 'repost') continue;
    const item = docToSyndicationItem(doc.id, d);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }

  feedCache.set(cacheKey, items);
  return items;
}

/** Últimos posts públicos de um usuário específico. */
export async function getUserFeedItems(uid: string, limit = 30): Promise<SyndicationItem[]> {
  const cacheKey = `user:${uid}:${limit}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return cached;

  const db = adminFirestore();
  const snap = await db
    .collection('posts')
    .where('userId', '==', uid)
    .where('visibility', '==', 'public')
    .orderBy('createdAt', 'desc')
    .limit(limit * 2)
    .get();

  const items: SyndicationItem[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.type === 'repost') continue;
    const item = docToSyndicationItem(doc.id, d);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }

  feedCache.set(cacheKey, items);
  return items;
}

export function renderRssXml(meta: {
  title: string;
  description: string;
  link: string;
  selfUrl: string;
  items: SyndicationItem[];
}): string {
  const itemsXml = meta.items
    .map((item) => {
      const pubDate = new Date(item.publishedIso).toUTCString();
      const enclosure = item.imageUrl
        ? `\n      <enclosure url="${escapeXml(item.imageUrl)}" type="image/jpeg" />`
        : '';
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="true">${escapeXml(item.url)}</guid>
      <pubDate>${escapeXml(pubDate)}</pubDate>
      <author>${escapeXml(item.authorName)}</author>
      <description>${escapeXml(item.text)}</description>${enclosure}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${escapeXml(meta.link)}</link>
    <description>${escapeXml(meta.description)}</description>
    <language>pt-BR</language>
    <atom:link href="${escapeXml(meta.selfUrl)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>
`;
}

export function renderJsonFeed(meta: {
  title: string;
  description: string;
  homeUrl: string;
  feedUrl: string;
  items: SyndicationItem[];
}) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    home_page_url: meta.homeUrl,
    feed_url: meta.feedUrl,
    description: meta.description,
    language: 'pt-BR',
    items: meta.items.map((item) => ({
      id: item.url,
      url: item.url,
      title: item.title,
      content_text: item.text,
      date_published: item.publishedIso,
      authors: [{ name: item.authorName }],
      ...(item.imageUrl ? { image: item.imageUrl } : {}),
    })),
  };
}

