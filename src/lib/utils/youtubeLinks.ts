// src/lib/utils/youtubeLinks.ts
// Reconhece endereços de vídeo do YouTube colados num post, comentário ou artigo: o link some do texto e o vídeo
// aparece dentro da publicação. Módulo sem nenhuma dependência do app, para poder ser conferido sozinho
// (`npm run e2e:youtube`).

/**
 * Endereços de vídeo em todas as formas que a pessoa pode colar: `watch?v=`, `youtu.be`, `embed`, `v`, **ao vivo**
 * (`/live/`) e **shorts** (`/shorts/`). O trecho final engole o resto do endereço (`?is=...`, `?t=42`, `&list=...`)
 * para não sobrar lixo no texto; ele para no espaço, no `<` e nas aspas, porque o texto é HTML (sem isso, um link
 * dentro de `<a href="...">` levaria junto a aspa e a tag).
 */
export const YOUTUBE_LINK_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|live|shorts)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&#][^\s<"']*)?/;

/** Endereço que o `<iframe>` do post usa (o `-nocookie` não é aceito aqui: é o nosso próprio HTML). */
export const youtubeEmbedUrl = (videoId: string) => `https://www.youtube.com/embed/${videoId}`;

/** Imagem de capa do vídeo (usada na prévia de compartilhamento e na lista de artigos). */
export const youtubeThumbnailUrl = (videoId: string) => `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

/** Verdadeiro somente para um endereço que contenha um vídeo do YouTube reconhecido. */
export const isYoutubeVideoUrl = (value: string | null | undefined): boolean =>
  !!value && !!extractYoutubeVideoInfo(value).videoId;

/**
 * Separa o vídeo do texto: devolve o identificador do vídeo (o primeiro, se houver vários) e o texto sem o link.
 */
export const extractYoutubeVideoInfo = (text: string): { videoId?: string; cleanedText?: string } => {
  if (!text) return { cleanedText: text };
  const match = text.match(YOUTUBE_LINK_REGEX);
  if (match && match[1]) {
    return { videoId: match[1], cleanedText: text.replace(YOUTUBE_LINK_REGEX, '').trim() };
  }
  return { videoId: undefined, cleanedText: text };
};
