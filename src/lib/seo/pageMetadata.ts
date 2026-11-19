import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

interface PageMetadataOptions {
  title: string;
  description: string;
  badge: string;
  path: string;
}

export function buildPageMetadata({ title, description, badge, path }: PageMetadataOptions): Metadata {
  const ogParams = new URLSearchParams({
    title,
    description,
    badge,
  });
  const ogImageUrl = `${siteConfig.baseUrl}/api/og?${ogParams.toString()}`;
  const fullTitle = `${title} | ${siteConfig.name}`;

  return {
    title,
    description,
    openGraph: {
      type: 'website',
      url: `${siteConfig.baseUrl}/pt-BR${path}`,
      title: fullTitle,
      description,
      siteName: siteConfig.name,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImageUrl],
    },
  };
}

