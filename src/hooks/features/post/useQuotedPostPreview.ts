// src/hooks/features/post/useQuotedPostPreview.ts
import { useState, useEffect, useCallback } from 'react';
import type { Post } from '@/lib/types';
import { useDebounce } from '@/hooks/use-debounce';
import { isYoutubeVideoUrl } from '@/lib/utils/youtubeLinks';

// Regex to find a URL at the very end of the text, optionally surrounded by whitespace.
const TRAILING_URL_REGEX = /(https?:\/\/[^\s]+)\s*$/;

// Pontuação que fecha a frase e NÃO faz parte do link: "veja (https://site.com/a)." não é o endereço "...a).".
const TRAILING_PUNCTUATION = /[.,;:!?'"”’»\]}>]+$/;

/**
 * Tira do fim do link capturado a pontuação da frase. O ")" final só fica se houver um "(" que o feche, como nos links da
 * Wikipédia (https://pt.wikipedia.org/wiki/Lula_(lula)). Antes o ")" ia junto, o site de origem respondia "não
 * encontrado" e a prévia falhava.
 */
export function cleanDetectedUrl(raw: string): string {
  let url = raw.trim();
  for (;;) {
    const withoutPunctuation = url.replace(TRAILING_PUNCTUATION, '');
    if (withoutPunctuation !== url) {
      url = withoutPunctuation;
      continue;
    }
    const opens = (url.match(/\(/g) ?? []).length;
    const closes = (url.match(/\)/g) ?? []).length;
    if (url.endsWith(')') && closes > opens) {
      url = url.slice(0, -1);
      continue;
    }
    return url;
  }
}

export function useQuotedPostPreview(
  text: string,
  onPreviewSuccess?: (url: string) => void
) {
  const [quotedPost, setQuotedPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);

  const debouncedText = useDebounce(text, 300);

  // Effect to detect URL
  useEffect(() => {
    // Only detect a new URL if there isn't already a quoted post
    if (quotedPost) return;

    const match = debouncedText.match(TRAILING_URL_REGEX);
    const candidateUrl = match ? cleanDetectedUrl(match[1]) : null;
    // YouTube já tem o player próprio do compositor. Antes o mesmo endereço também passava por quote-preview e
    // desenhava um segundo cartão logo abaixo do player.
    const newUrl = candidateUrl && !isYoutubeVideoUrl(candidateUrl) ? candidateUrl : null;
    
    // Only update if the URL changes
    if (newUrl !== detectedUrl) {
      setDetectedUrl(newUrl);
      if(newUrl) {
          setIsLoading(true);
      } else {
          // If the newUrl is null but we had a detectedUrl, it means the user deleted it.
          setIsLoading(false);
          setError(null);
      }
    }

  }, [debouncedText, quotedPost, detectedUrl]);

  // Effect to fetch the preview when a URL is detected
  useEffect(() => {
    const fetchPreview = async () => {
      // Do not fetch if a post is already quoted or if there's no URL
      if (quotedPost || !detectedUrl) {
        if (!detectedUrl) setIsLoading(false); // Ensure loading stops if URL is removed
        return;
      }

      setError(null);

      try {
        const res = await fetch(`/api/quote-preview?url=${encodeURIComponent(detectedUrl)}`);

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.message || `Failed to fetch preview with status: ${res.status}`);
        }

        const data: Post = await res.json();
        setQuotedPost(data);
        if (onPreviewSuccess) {
          onPreviewSuccess(detectedUrl);
        }
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred.');
        setQuotedPost(null);
      } finally {
        setIsLoading(false);
      }
    };

    if (detectedUrl) {
        fetchPreview();
    }
  }, [detectedUrl, onPreviewSuccess, quotedPost]);

  const removeQuotedPost = useCallback(() => {
    setQuotedPost(null);
    setDetectedUrl(null); // Clear the detected URL as well
    setError(null);
    setIsLoading(false); // Ensure loading is stopped
    // The calling component is responsible for removing the URL from its own text state
  }, []);

  return { quotedPost, isLoading, error, removeQuotedPost };
}
