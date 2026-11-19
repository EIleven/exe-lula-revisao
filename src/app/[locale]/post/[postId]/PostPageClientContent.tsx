// src/app/[locale]/post/[postId]/PostPageClientContent.tsx
'use client';

import React, { useState, useEffect, Fragment } from 'react';
import { getPostById } from '@/lib/services/postReadService'
import { useParams } from 'next/navigation'
import PostCard from '@/components/feed/PostCard'
import { PostInteractions } from './PostInteractions'
import PostPageHeader from './PostPageHeader'
import PostCardSkeleton from '@/components/feed/PostCardSkeleton';
import type { Post } from '@/lib/types';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { isPublicSafe } from '@/lib/feed/publicVisibility';
import { siteConfig } from '@/config/site';


const PostPageSkeleton = () => (
  <main className="w-full min-w-0">
    <PostPageHeader text="Post" />
    <PostCardSkeleton />
  </main>
);

export default function PostPageClientContent() {
  const params = useParams();
  const postId = params.postId as string;
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const locale = useLocale();
  const { currentUser, isLoading: isLoadingUser } = useCurrentUser();
  const viewerId = currentUser?.id ?? null;

  // Espera a sessão: o post "só para seguidores" precisa ser buscado com o login de quem abriu (antes era buscado
  // antes de a sessão carregar, como visitante, e o seguidor via "não encontrado").
  const [isSessionResolved, setIsSessionResolved] = useState(false);
  useEffect(() => {
    if (!isLoadingUser) setIsSessionResolved(true);
  }, [isLoadingUser]);

  useEffect(() => {
    if (postId && isSessionResolved) {
      let cancelled = false;
      setIsLoading(true);
      (async () => {
        try {
          if (postId.startsWith('ap_')) {
            await fetch(`/api/ap/remote-post-interactions?postId=${encodeURIComponent(postId)}&mode=comments`).catch(() => null);
          }
          const fetchedPost = await getPostById(postId, viewerId);
          // Visitante sem conta não vê conteúdo com aviso nem fora do português, nem abrindo o endereço direto: o item
          // simplesmente não existe para ele, como no feed.
          const permitido = fetchedPost && (viewerId ? true : isPublicSafe(fetchedPost));
          if (!cancelled) setPost(permitido ? fetchedPost : null);
        } catch (err) {
          console.error(`Error fetching post ${postId} in component:`, err);
          if (!cancelled) setPost(null);
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [postId, isSessionResolved, viewerId]);

  if (isLoading) {
    return <PostPageSkeleton />;
  }

  if (!post) {
    return (
      <main className="w-full min-w-0 p-8 text-center space-y-2">
        <h2 className="text-2xl font-bold">Post indisponível</h2>
        <p className="text-muted-foreground">
          {viewerId
            ? 'Este post não existe, foi apagado ou é de um perfil privado que você não segue.'
            : 'Este post não existe, foi apagado ou é só para seguidores de um perfil privado.'}
        </p>
        {!viewerId && (
          <Link href={`/${locale}/login?redirect=${encodeURIComponent(`/${locale}/post/${postId}`)}`} className="inline-block text-primary hover:underline">
            Entrar na sua conta
          </Link>
        )}
      </main>
    );
  }

  return (
    <Fragment>
      <main className="w-full min-w-0">
        <PostPageHeader text={post.category === 'news' ? 'Artigo' : 'Post'} />
        <PostCard post={post} isSinglePostView={true} />
        {/* Respiro inferior para que as barras fixas no mobile/app (chrome-bottom + FloatingCommentBar) nunca tampem os botões do último comentário */}
        <div className="h-[calc(9.5rem+env(safe-area-inset-bottom,0px))] md:h-12" aria-hidden="true" />
      </main>
      <PostInteractions />
    </Fragment>
  )
}
