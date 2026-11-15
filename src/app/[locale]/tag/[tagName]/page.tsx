
// src/app/tag/[tagName]/page.tsx
import { getPostsByHashtag } from '@/lib/services/postReadService';
import type { Metadata, ResolvingMetadata } from 'next';
import TagPageClientContent from './TagPageClientContent';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { Fragment } from 'react';

export const revalidate = 600; // Revalidate this page at most every 10 minutes

type Props = {
  params: { tagName: string };
};

const BASE_URL = siteConfig.baseUrl;

// Placeholder for a function that might fetch details about a hashtag (e.g., count, created date)
// For now, we'll focus on the name for metadata.
async function getTagInfo(tagName: string): Promise<{ name: string; exists: boolean; postsCount?: number } | null> {
  // In a real app, you might query a separate 'tags' collection or an aggregation.
  // For now, we just use the tagName. If getPostsByHashtag returns 0 posts, it might not "exist" prominently.
  // This is a simplified check.
  const initialPosts = await getPostsByHashtag(tagName); // This call is just for existence check / initial info
  return {
    name: tagName,
    exists: initialPosts.length > 0, // A simple way to check if the tag has content
    postsCount: initialPosts.length // This count is from a potentially limited initial fetch
  };
}

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const tagName = decodeURIComponent(params.tagName);
  const actualTagName = tagName.startsWith('#') ? tagName : `#${tagName}`;

  // const tagInfo = await getTagInfo(actualTagName);
  // For simplicity, we'll construct metadata without fetching full tag info here,
  // as the main content loading will be client-side and paginated.

  const siteName = 'Exe. Lula';
  const tagUrl = `${BASE_URL}/tag/${encodeURIComponent(actualTagName)}`;
  const title = `Posts tagged with ${actualTagName} | ${siteName}`;
  const description = `Explore posts and discussions tagged with ${actualTagName} on ${siteName}.`;
  
  // const resolvedParent = await parent;
  // const previousImages = resolvedParent.openGraph?.images || [];

  return {
    title: title,
    description: description,
    alternates: {
      canonical: tagUrl,
    },
    openGraph: {
      title: title,
      description: description,
      url: tagUrl,
      siteName: siteName,
      type: 'website',
      // images: previousImages, // Add images if relevant for tag pages
    },
    twitter: {
      card: 'summary_large_image',
      title: title,
      description: description,
      // images: [],
    },
  };
}

export default async function TagPageServer({ params }: Props) {
  const tagName = decodeURIComponent(params.tagName);
  const actualTagName = tagName.startsWith('#') ? tagName : `#${tagName}`;

  // No need to fetch all posts here anymore. This will be handled by FeedList in the client component.
  // The existence of the tag will be implicitly handled by FeedList showing "No posts found" if empty.

  return (
    <Fragment>
        <main className="w-full min-w-0">
            <TagPageClientContent tagName={actualTagName} />
        </main>
        {/* Empty aside to fill the grid */}
        <aside className="hidden xl:block"></aside>
    </Fragment>
  );
}

    