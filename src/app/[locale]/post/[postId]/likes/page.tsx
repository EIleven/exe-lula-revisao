// src/app/post/[postId]/likes/page.tsx
import { notFound } from 'next/navigation';
import { getPostById, getUsersWhoLikedPost } from '@/lib/services/postReadService';
import UserListClientPage from '@/components/profile/UserListClientPage';
import { getCurrentUserId } from '@/lib/services/authService';
import { getTranslations } from 'next-intl/server';
import { getLocale } from 'next-intl/server';

type Props = {
  params: { postId: string };
};

export default async function PostLikesPage({ params }: Props) {
  const t = await getTranslations('UserListClientPageDefaults');
  const locale = await getLocale();
  const activeUserId = getCurrentUserId();
  const post = await getPostById(params.postId, activeUserId);

  if (!post) {
    notFound();
  }

  const users = await getUsersWhoLikedPost(params.postId, activeUserId);

  return (
    <UserListClientPage
      users={users}
      pageTitle={t('likedByTitle')}
      pageDescription={t('likedByDescription', { username: post.user?.username })}
      backLink={`/${locale}/post/${post.id}`}
      backLabel={t('backToPost')}
      emptyStateText={t('noLikes')}
      iconName="heart"
      remoteInteractionsUrl={
        post.id.startsWith('ap_')
          ? `/api/ap/remote-post-interactions?postId=${encodeURIComponent(post.id)}&mode=likes`
          : undefined
      }
    />
  );
}
