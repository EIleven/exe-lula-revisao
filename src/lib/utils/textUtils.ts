// src/lib/utils/textUtils.ts
import { lookupUsersByUsername } from '@/lib/services/mentionLookup';
// Links de vídeo do YouTube moram em utils/youtubeLinks.ts (sem dependência do app, conferido por npm run e2e:youtube).
import { youtubeThumbnailUrl } from './youtubeLinks';
export { extractYoutubeVideoInfo, youtubeEmbedUrl, youtubeThumbnailUrl } from './youtubeLinks';

/**
 * Extracts unique hashtags (case-sensitive) from a string.
 * @param text The input string, which can be plain text or HTML.
 * @returns An array of unique hashtags (e.g., ["#Tag1", "#tag2"]).
 */
export const extractHashtagsFromString = (text: string | undefined): string[] => {
    if (!text) return [];
    
    // First, strip HTML tags to get plain text for accurate hashtag extraction
    const plainText = text.replace(/<[^>]*>?/gm, ' ');

    // Updated regex to include common accented characters and ç
    const hashtagRegex = /#([a-zA-Z0-9_áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇ]+)/g;
    const matches = plainText.match(hashtagRegex);
    return matches ? [...new Set(matches)] : [];
};

/**
 * Extracts the URL of the first image or a YouTube thumbnail from an HTML string.
 * @param html The HTML content of a post.
 * @returns The URL of the first media found, or null if none.
 */
export const extractFirstMediaFromHtml = (html: string | null | undefined): string | null => {
    if (!html) return null;

    // 1. Look for the first <img> tag and extract its src
    // This regex is more robust and captures URLs with query parameters (like Firebase Storage tokens)
    const imgRegex = /<img[^>]+src="([^"]+)"/;
    const imgMatch = html.match(imgRegex);
    if (imgMatch && imgMatch[1]) {
        // Ensure the URL is valid and not a local file path
        if (imgMatch[1].startsWith('http://') || imgMatch[1].startsWith('https://')) {
          // The captured group might have HTML entities like &amp; instead of &
          // We need to decode them for the URL to be valid.
          const decodedUrl = imgMatch[1].replace(/&amp;/g, '&');
          return decodedUrl;
        }
    }

    // 2. If no image, look for a YouTube iframe
    const youtubeRegex = /<iframe[^>]+src="https:\/\/www\.youtube\.com\/embed\/([a-zA-Z0-9_-]{11})"/;
    const youtubeMatch = html.match(youtubeRegex);
    if (youtubeMatch && youtubeMatch[1]) {
        return youtubeThumbnailUrl(youtubeMatch[1]);
    }

    return null;
};


/**
 * Finds @mentions in an HTML string and replaces them with links to user profiles.
 * @param html The HTML content.
 * @returns A Promise that resolves to the HTML string with mentions linkified.
 */
export const linkifyMentionsInHtml = async (html: string): Promise<string> => {
    if (!html) return html;
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const mentions = html.match(mentionRegex);
    if (!mentions) return html;

    const uniqueUsernames = [...new Set(mentions.map(m => m.substring(1)))];
    
    const userMap = await lookupUsersByUsername(uniqueUsernames); // @ em minúsculas -> perfil

    return html.replace(mentionRegex, (match, username) => {
        const userId = userMap.get(username.toLowerCase())?.id;
        if (userId) {
            return `<a href="/profile/${userId}" class="text-primary hover:underline" data-interactive="true" onclick="event.stopPropagation()">${match}</a>`;
        }
        return match; // Return the original mention if user not found
    });
};

/**
 * Finds #hashtags in an HTML string and replaces them with links to tag pages.
 * It's designed to not linkify text within existing anchor tags.
 * @param html The HTML content.
 * @param locale The current locale (e.g., 'pt-BR').
 * @returns The HTML string with hashtags linkified.
 */
export const linkifyHashtagsInHtml = (html: string, locale: string): string => {
    if (!html) return html;

    // Só no TEXTO, fora de tags e de links: antes "#secao" dentro de um href e entidades como "&#39;" viravam links
    // e quebravam o HTML. O "#" precisa vir no início ou depois de algo que não seja "&" nem letra/número.
    const hashtagRegex = /(^|[^&\w])#([a-zA-Z0-9_áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇ]+)/g;
    let openLinks = 0;
    return html.split(/(<[^>]*>)/g).map((part) => {
        if (part.startsWith('<')) {
            if (/^<a[\s>]/i.test(part)) openLinks++;
            else if (/^<\/a\s*>/i.test(part)) openLinks = Math.max(0, openLinks - 1);
            return part;
        }
        if (openLinks > 0) return part;
        // O clique no link não abre o post: o cartão ignora cliques em <a> e em [data-interactive].
        return part.replace(hashtagRegex, (_match, before: string, tagName: string) =>
            `${before}<a href="/${locale}/tag/${encodeURIComponent(tagName)}" class="text-primary hover:underline" data-interactive="true">#${tagName}</a>`);
    }).join('');
};
