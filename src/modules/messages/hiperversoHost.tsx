// src/modules/messages/hiperversoHost.tsx
'use client';

import React, { useEffect, useState } from 'react';
import EmbeddedPostCard from '@/components/feed/EmbeddedPostCard';
import { getPostById } from '@/lib/services/postReadService';
import { createPost } from '@/lib/services/postService';
import type { Post } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { MessagesHostProvider } from './MessagesHostContext';
import type { MessagesHostAdapter } from './contracts';

const HostSharedPostPreview: React.FC<{ postId: string }> = ({ postId }) => {
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPostById(postId)
      .then((res) => {
        if (active) setPost(res ?? null);
      })
      .catch(() => {
        if (active) setPost(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [postId]);

  if (loading) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (!post) return null;
  return <EmbeddedPostCard post={post} />;
};

const hiperversoMessagesAdapter: MessagesHostAdapter = {
  renderSharedPost: (postId) => <HostSharedPostPreview postId={postId} />,
  publishGroupInvite: async ({ userId, text }) => {
    await createPost({
      userId,
      text,
      allowReposts: true,
      replyPermission: 'everyone',
      category: 'echo',
      federation: 'public',
    });
  },
  getProfileHref: (userId, locale) => `/${locale}/profile/${userId}`,
  getPostHref: (postId, locale) => `/${locale}/post/${postId}`,
};

export const HiperversoMessagesHostProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MessagesHostProvider adapter={hiperversoMessagesAdapter}>
    {children}
  </MessagesHostProvider>
);
