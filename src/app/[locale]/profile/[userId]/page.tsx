// This is now a Server Component to leverage generateMetadata
import { getUser as serverGetUser } from '@/lib/services/userService';
import type { Metadata, ResolvingMetadata } from 'next';
import ProfileClientPageContent from './ProfileClientPageContent';
import type { User } from '@/lib/types';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { getLocale } from 'next-intl/server';
import { Fragment } from 'react';

export const revalidate = 3600; // Revalidate this page at most once per hour

type Props = {
  params: { userId: string };
};

const BASE_URL = siteConfig.baseUrl;

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const userId = params.userId;
  const locale = await getLocale();
  // Fetch user without activeUserId to avoid circular dependency issues for metadata
  // This is okay: if the user is private, we get generic metadata, which is better than an error.
  const user = await serverGetUser(userId, null);

  if (!user) {
    return {
      title: 'User Not Found | Exe. Lula',
      description: 'The user profile you are looking for could not be found.',
       robots: {
        index: false,
        follow: false,
      },
    };
  }

  const siteName = 'Exe. Lula';
  const profileUrl = `${BASE_URL}/${locale}/profile/${userId}`;
  const title = `${user.name} (@${user.username}) | ${siteName}`;
  const description = user.bio || `View the profile of ${user.name} (@${user.username}) on ${siteName}.`;
  
  const resolvedParent = await parent;
  const previousImages = resolvedParent.openGraph?.images || [];
  const specificImage = user.avatarUrl ? [{ url: user.avatarUrl, alt: `${user.name}'s avatar` }] : [];

  return {
    title: title,
    description: description,
    alternates: {
      canonical: profileUrl,
    },
    openGraph: {
      title: title,
      description: description,
      url: profileUrl,
      siteName: siteName,
      type: 'profile', // OG type for profiles
      profile: {
        firstName: user.name.split(' ')[0],
        lastName: user.name.split(' ').slice(1).join(' '),
        username: user.username,
      },
      images: specificImage.length > 0 ? specificImage : previousImages,
    },
    twitter: {
      card: 'summary', // Profiles usually use summary card
      title: title,
      description: description,
      images: user.avatarUrl ? [user.avatarUrl] : (resolvedParent.twitter?.images || []),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}


export default async function ProfilePageServer({ params }: Props) {
  // We no longer pre-fetch the user on the server for the page component.
  // We let the client component ('ProfileClientPageContent') handle it with the correct auth context.
  // This prevents the 404 error for private profiles when viewed by their owner.
  // We also don't generate JSON-LD here as we don't have user data. This could be moved
  // to the client component using a <script> tag and a useEffect if it's important.
  return (
    <Fragment>
      <main className="w-full min-w-0">
          <ProfileClientPageContent profileUserIdParam={params.userId} />
      </main>
      {/* The right aside for profiles could show "similar users" or other contextual info, but is not implemented yet. */}
      <aside className="hidden xl:block sticky top-[72px] h-fit"></aside>
    </Fragment>
  );
}
