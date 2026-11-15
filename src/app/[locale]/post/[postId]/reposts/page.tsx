
// src/app/post/[postId]/reposts/page.tsx
import { notFound } from 'next/navigation';
import { getPostById, getUsersWhoRepostedPost } from '@/lib/services/postReadService';
import { getCurrentUserId } from '@/lib/services/authService';
import UserListClientPage from '@/components/profile/UserListClientPage';
import { getTranslations } from 'next-intl/server';
import { getLocale } from 'next-intl/server';

type Props = {
  params: { postId: string };
};

export default async function PostRepostsPage({ params }: Props) {
  const t = await getTranslations('UserListClientPageDefaults');
  const locale = await getLocale();
  const activeUserId = getCurrentUserId();
  const post = await getPostById(params.postId, activeUserId);

  if (!post) {
    notFound();
  }

  // This now returns User[] directly.
  const users = await getUsersWhoRepostedPost(params.postId, activeUserId);

  return (
    <UserListClientPage
      users={users}
      pageTitle={t('repostsTitle')}
      pageDescription={t('repostsDescription', { username: post.user?.username })}
      backLink={`/${locale}/post/${post.id}`}
      backLabel={t('backToPost')}
      emptyStateText={t('noReposts')}
      iconName="repeat"
      remoteInteractionsUrl={
        post.id.startsWith('ap_')
          ? `/api/ap/remote-post-interactions?postId=${encodeURIComponent(post.id)}&mode=reposts`
          : undefined
      }
    />
  );
}

    