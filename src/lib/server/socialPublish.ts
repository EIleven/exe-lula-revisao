import { RichText } from '@atproto/api';
import { htmlToPlainText } from '@/lib/security/sanitizeHtml';
import { siteConfig } from '@/config/site';
import type { SocialProvider, SocialPublishResult } from '@/lib/social/types';
import { getBlueskyAgent } from './blueskyOAuth';
import { getConnection, claimPublication, finishPublication } from './socialStore';

// Kept separate from the OAuth modules so text composition and provider calls have one auditable path.
type PublishablePost = {
  id: string;
  userId: string;
  text?: string | null;
  headline?: string | null;
  visibility?: string;
  isDeleted?: boolean;
  authorDetails?: { name?: string; username?: string };
};

const graphemes = (value: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (part) => part.segment);

function truncate(value: string, maximum: number): string {
  const parts = graphemes(value);
  if (parts.length <= maximum) return value;
  return `${parts.slice(0, Math.max(0, maximum - 1)).join('').trimEnd()}…`;
}

function plainPostText(post: PublishablePost): string {
  return htmlToPlainText(post.headline || post.text || '').replace(/\s+/g, ' ').trim();
}

function canonicalPostUrl(postId: string, locale: string): string {
  return `${siteConfig.officialOrigin}/${locale === 'en' ? 'en' : 'pt-BR'}/post/${encodeURIComponent(postId)}`;
}

async function publishBluesky(uid: string, post: PublishablePost, locale: string) {
  const connection = await getConnection(uid, 'bluesky');
  if (!connection?.did) throw new Error('not-connected');
  const agent = await getBlueskyAgent(connection.did);
  const sourceUrl = canonicalPostUrl(post.id, locale);
  const isArticle = Boolean(post.headline?.trim());
  const rawBody = htmlToPlainText(post.text || '').replace(/\s+/g, ' ').trim();
  const body = isArticle
    ? (() => {
        const headline = truncate(post.headline!.trim(), 110);
        const suffix = `\n\n${sourceUrl}`;
        const maxExcerpt = Math.max(0, 295 - graphemes(headline).length - graphemes(suffix).length - 4);
        const excerpt = rawBody && maxExcerpt > 20 ? `\n\n${truncate(rawBody, maxExcerpt)}` : '';
        return `${headline}${excerpt}${suffix}`;
      })()
    : truncate(plainPostText(post), 290) || (locale === 'en' ? 'New post on Exe. Lula' : 'Novo post no Exe. Lula');
  const richText = new RichText({ text: body });
  await richText.detectFacets(agent);
  const response = await agent.post({
    text: richText.text,
    facets: richText.facets,
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: sourceUrl,
        title: truncate(post.headline || `Post de ${post.authorDetails?.name || post.authorDetails?.username || 'Exe. Lula'}`, 100),
        description: truncate(rawBody || plainPostText(post), 240),
      },
    },
  });
  const rkey = response.uri.split('/').pop();
  return { externalId: response.uri, url: `https://bsky.app/profile/${connection.did}/post/${rkey}` };
}

export async function publishToProvider(
  uid: string,
  post: PublishablePost,
  provider: SocialProvider,
  locale: string,
): Promise<SocialPublishResult> {
  const claimed = await claimPublication(uid, post.id, provider);
  if (!claimed.claim) {
    if ('previous' in claimed && claimed.previous) return { provider, ok: true, url: claimed.previous.url, alreadyPublished: true };
    return { provider, ok: false, error: 'A publicação nessa rede já está em andamento.' };
  }
  try {
    const result = await publishBluesky(uid, post, locale);
    await finishPublication(uid, post.id, provider, { status: 'success', ...result });
    return { provider, ok: true, url: result.url };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : 'unknown';
    console.error(`Social publish failed (${provider}):`, code);
    await finishPublication(uid, post.id, provider, { status: 'failed', errorCode: code });
    return {
      provider,
      ok: false,
      error: 'O Bluesky recusou o envio. Reconecte a conta e tente novamente.',
    };
  }
}
