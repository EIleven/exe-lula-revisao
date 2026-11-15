// src/components/shared/LinkPreviewCard.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import type { Post } from '@/lib/types';
import EmbeddedPostCard from '@/components/feed/EmbeddedPostCard';

interface LinkPreviewData {
  id?: string;
  headline?: string;
  text?: string;
  media?: Array<{ url?: string; type?: string; alt?: string }>;
  sourceUrl?: string;
}

const previewCache = new Map<string, LinkPreviewData | null>();
const inflightRequests = new Map<string, Promise<LinkPreviewData | null>>();

function fetchPreviewOnce(url: string): Promise<LinkPreviewData | null> {
  if (previewCache.has(url)) {
    return Promise.resolve(previewCache.get(url) ?? null);
  }
  const existing = inflightRequests.get(url);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/quote-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        previewCache.set(url, null);
        return null;
      }
      const data = (await res.json()) as LinkPreviewData;
      const hasUsefulContent = Boolean(data?.headline?.trim() || data?.text?.trim());
      const value = hasUsefulContent ? data : null;
      previewCache.set(url, value);
      return value;
    } catch {
      previewCache.set(url, null);
      return null;
    } finally {
      inflightRequests.delete(url);
    }
  })();

  inflightRequests.set(url, promise);
  return promise;
}

export function extractFirstUrlFromText(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>()]+/i);
  if (!match) return null;
  return match[0].replace(/[.,!?;:]+$/, '');
}

interface LinkPreviewCardProps {
  url: string;
}

export default function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const [data, setData] = useState<LinkPreviewData | null>(() => previewCache.get(url) ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(() => !previewCache.has(url));

  useEffect(() => {
    let cancelled = false;
    if (previewCache.has(url)) {
      setData(previewCache.get(url) ?? null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchPreviewOnce(url).then((result) => {
      if (cancelled) return;
      setData(result);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (isLoading) {
    return <div className="mt-2 h-[74px] w-full rounded-xl border border-border bg-muted/30 animate-pulse" />;
  }

  if (!data) return null;

  // Se for um post interno do próprio Exe. Lula retornado por /api/quote-preview
  if (data.id && !data.id.startsWith('http') && 'userId' in data) {
    return <EmbeddedPostCard post={data as Post} />;
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    hostname = url;
  }

  const imageUrl = data.media?.[0]?.url;
  const title = data.headline?.trim();
  const description = data.text?.trim();

  if (!title && !description) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      data-interactive="true"
      className="mt-2 block overflow-hidden rounded-xl border border-border bg-card/60 hover:bg-muted/40 transition-colors"
    >
      {imageUrl && (
        <div className="w-full max-h-56 overflow-hidden border-b border-border bg-muted">
          <img
            src={imageUrl}
            alt={title || hostname}
            className="w-full max-h-56 object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const parent = e.currentTarget.parentElement;
              if (parent) parent.style.display = 'none';
            }}
          />
        </div>
      )}
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{hostname}</span>
          <ExternalLink className="h-3 w-3 ml-auto shrink-0 opacity-60" />
        </div>
        {title && (
          <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">
            {title}
          </p>
        )}
        {description && description !== title && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </a>
  );
}

