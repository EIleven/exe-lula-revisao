// src/app/post/[postId]/quotes/page.tsx
import { notFound } from 'next/navigation';
import { getPostById, getUsersWhoQuotedPost } from '@/lib/services/postReadService';
import { getCurrentUserId } from '@/lib/services/authService';
import PostListClientPage from '@/components/profile/PostListClientPage'; // We will create this
import { getTranslations } from 'next-intl/server';
import { getLocale } from 'next-intl/server';

type Props = {
  params: { postId: string };
};

export default async function PostQuotesPage({ params }: Props) {
  const t = await getTranslations('UserListClientPageDefaults');
  const locale = await getLocale();
  const activeUserId = getCurrentUserId();
  const post = await getPostById(params.postId, activeUserId);

  if (!post) {
    notFound();
  }

  // This fetches only quotes
  const quotePosts = await getUsersWhoQuotedPost(params.postId, activeUserId);

  return (
    <PostListClientPage
      posts={quotePosts}
      pageTitle={t('quotesTitle')}
      pageDescription={t('quotesDescription', { username: post.user?.username, count: quotePosts.length })}
      backLink={`/${locale}/post/${post.id}`}
      backLabel={t('backToPost')}
      emptyStateText={t('noQuotes')}
      iconName="edit3" // Using Edit3 for quote icon
    />
  );
}
