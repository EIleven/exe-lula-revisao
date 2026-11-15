// src/components/feed/PostCardHeader.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import type { Post } from '@/lib/types';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard'; // Import the new component
import { useLocale, useTranslations } from 'next-intl';
import { trackProfileClick } from '@/lib/services/analyticsService';
import { formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Newspaper } from 'lucide-react';
import FederationBadge from '@/components/federation/FederationBadge';

interface PostCardHeaderProps {
  post: Post;
  currentUserId: string | null;
  timeAgo: string;
  isSinglePostView?: boolean;
}

export default function PostCardHeader({
  post,
  currentUserId,
  timeAgo: initialTimeAgo,
  isSinglePostView = false,
}: PostCardHeaderProps) {
  const locale = useLocale();
  const t = useTranslations('PostCardHeader');

  const timeAgo = React.useMemo(() => {
    if (!post.createdAt) return '';
    try {
        const formatted = formatDistanceToNow(new Date(post.createdAt), {
          addSuffix: true,
          locale: locale === 'pt-BR' ? ptBR : enUS,
        });
        return locale === 'pt-BR' ? formatted.replace('cerca de ', '') : formatted;
    } catch (e) {
        console.error("Error formatting date:", e, "Input:", post.createdAt);
        return 'a while ago';
    }
  }, [post.createdAt, locale]);

  const handleProfileClick = (e: React.MouseEvent) => {
      e.stopPropagation(); // Stop propagation to prevent card navigation if needed
      trackProfileClick(post.id);
      // The Link component will handle the navigation itself.
  };

  const isRemoteFediverse =
    Boolean((post as Post & { isRemoteFediverse?: boolean }).isRemoteFediverse) ||
    String(post.userId || '').startsWith('ap_') ||
    String(post.user?.id || '').startsWith('ap_') ||
    String(post.user?.username || '').includes('@');
  const remoteHandle = isRemoteFediverse ? post.user?.username : undefined;
  const remoteDomain = remoteHandle && remoteHandle.includes('@') ? remoteHandle.split('@')[1] : undefined;
  
  // For single post view, stack name and username
  if (isSinglePostView) {
      return (
        <div className="flex items-start justify-between">
          <div className="flex flex-col items-start min-w-0">
             <UserProfileHoverCard user={post.user}>
                  <Link 
                      href={`/${locale}/profile/${post.user.id}`} 
                      className="cursor-pointer hover:underline" 
                      onClick={handleProfileClick} 
                      data-interactive="true"
                  >
                      <p className="text-base font-semibold text-foreground truncate">{post.user.name}</p>
                  </Link>
              </UserProfileHoverCard>
              <UserProfileHoverCard user={post.user}>
                  <Link
                      href={`/${locale}/profile/${post.user.id}`} 
                      className="cursor-pointer hover:underline" 
                      onClick={handleProfileClick} 
                      data-interactive="true"
                  >
                      <p className="text-sm text-muted-foreground truncate">@{post.user.username}</p>
                  </Link>
              </UserProfileHoverCard>
          </div>
          <div className="ml-4 flex items-center gap-1.5 shrink-0">
            {post.category === 'news' && post.newsCategory && (
              <Badge variant="secondary">
                <Newspaper className="mr-1.5 h-3 w-3" />
                {post.newsCategory}
              </Badge>
            )}
            <FederationBadge
              reach={post.federation}
              isRemote={isRemoteFediverse}
              remoteHandle={remoteHandle}
              remoteDomain={remoteDomain}
            />
          </div>
        </div>
      );
  }

  // Default view for feeds
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 min-w-0 flex-1">
        <UserProfileHoverCard user={post.user}>
            <Link 
                href={`/${locale}/profile/${post.user.id}`} 
                className="cursor-pointer hover:underline" 
                onClick={handleProfileClick} 
                data-interactive="true"
            >
                <p className="text-sm font-semibold text-foreground truncate">{post.user.name}</p>
            </Link>
        </UserProfileHoverCard>
        
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1 min-w-0">
          <UserProfileHoverCard user={post.user}>
            <Link 
                href={`/${locale}/profile/${post.user.id}`} 
                className="cursor-pointer hover:underline truncate max-w-[160px] sm:max-w-none" 
                onClick={handleProfileClick} 
                data-interactive="true"
            >
              <span className="truncate">@{post.user.username}</span>
            </Link>
          </UserProfileHoverCard>
          <span>·</span>
          <span className="whitespace-nowrap">{timeAgo}</span>
          {post.isEdited && <span className="italic text-muted-foreground/80 whitespace-nowrap">{t('edited')}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {post.category === 'news' && post.newsCategory && (
          <Badge
            variant="default"
            className="bg-accent text-accent-foreground shrink-0 text-[11px] px-2 py-0.5 font-medium max-w-[130px] truncate"
          >
            {post.newsCategory}
          </Badge>
        )}
        <FederationBadge
          reach={post.federation}
          isRemote={isRemoteFediverse}
          remoteHandle={remoteHandle}
          remoteDomain={remoteDomain}
        />
      </div>
    </div>
  );
}
