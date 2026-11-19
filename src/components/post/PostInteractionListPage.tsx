// src/components/post/PostInteractionListPage.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import {
  getPostById,
  getUsersWhoLikedPost,
  getUsersWhoQuotedPost,
  getUsersWhoRepostedPost,
} from '@/lib/services/postReadService';
import type { Post, User } from '@/lib/types';
import UserListClientPage from '@/components/profile/UserListClientPage';
import PostListClientPage from '@/components/profile/PostListClientPage';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PostInteractionListPageProps {
  mode: 'likes' | 'reposts' | 'quotes';
}

export default function PostInteractionListPage({ mode }: PostInteractionListPageProps) {
  const params = useParams();
  const postId = typeof params?.postId === 'string' ? params.postId : '';
  const locale = useLocale();
  const t = useTranslations('UserListClientPageDefaults');
  const { currentUser, isLoading: isLoadingUser } = useCurrentUser();

  const [post, setPost] = useState<Post | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [quotePosts, setQuotePosts] = useState<Post[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  useEffect(() => {
    if (isLoadingUser || !postId) return;
    let cancelled = false;
    const viewerId = currentUser?.id ?? null;

    setIsLoadingData(true);
    (async () => {
      try {
        const fetchedPost = await getPostById(postId, viewerId);
        if (cancelled) return;
        setPost(fetchedPost ?? null);
        if (!fetchedPost) return;

        if (mode === 'likes') {
          const list = await getUsersWhoLikedPost(postId, viewerId);
          if (!cancelled) setUsers(list);
        } else if (mode === 'reposts') {
          const list = await getUsersWhoRepostedPost(postId, viewerId);
          if (!cancelled) setUsers(list);
        } else {
          const list = await getUsersWhoQuotedPost(postId, viewerId);
          if (!cancelled) setQuotePosts(list);
        }
      } catch {
        if (!cancelled) setPost(null);
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [postId, mode, currentUser?.id, isLoadingUser]);

  if (isLoadingUser || isLoadingData) {
    return (
      <div className="container mx-auto max-w-xl py-8 space-y-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="container mx-auto max-w-xl py-12 px-4 text-center">
        <Card>
          <CardContent className="py-10 space-y-4">
            <h1 className="text-xl font-bold text-foreground">Post não encontrado ou restrito</h1>
            <p className="text-sm text-muted-foreground">
              Este conteúdo pode ser privado ou não estar mais disponível.
            </p>
            <Button asChild>
              <Link href={`/${locale}`}>Voltar ao Feed</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === 'quotes') {
    return (
      <PostListClientPage
        posts={quotePosts}
        pageTitle={t('quotesTitle')}
        pageDescription={t('quotesDescription', {
          username: post.user?.username,
          count: quotePosts.length,
        })}
        backLink={`/${locale}/post/${post.id}`}
        backLabel={t('backToPost')}
        emptyStateText={t('noQuotes')}
        iconName="edit3"
      />
    );
  }

  const isLikes = mode === 'likes';
  return (
    <UserListClientPage
      users={users}
      pageTitle={isLikes ? t('likedByTitle') : t('repostsTitle')}
      pageDescription={
        isLikes
          ? t('likedByDescription', { username: post.user?.username })
          : t('repostsDescription', { username: post.user?.username })
      }
      backLink={`/${locale}/post/${post.id}`}
      backLabel={t('backToPost')}
      emptyStateText={isLikes ? t('noLikes') : t('noReposts')}
      iconName={isLikes ? 'heart' : 'repeat'}
      remoteInteractionsUrl={
        post.id.startsWith('ap_')
          ? `/api/ap/remote-post-interactions?postId=${encodeURIComponent(post.id)}&mode=${mode}`
          : undefined
      }
    />
  );
}
