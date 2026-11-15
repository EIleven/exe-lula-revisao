// src/components/profile/PostListClientPage.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { navigateBack } from '@/lib/backNavigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import PostCard from '@/components/feed/PostCard'; // Assuming you have this component
import type { Post } from '@/lib/types';
import { ArrowLeft, Edit3, List } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useTranslations } from 'next-intl';

// Define a mapping from string names to icon components
const iconMap = {
  edit3: Edit3,
  list: List,
  default: List,
};

type IconName = keyof typeof iconMap;

interface PostListClientPageProps {
  posts: Post[];
  pageTitle: string;
  pageDescription: string;
  backLink: string;
  backLabel: string;
  emptyStateText: string;
  iconName: IconName;
}

export default function PostListClientPage({
  posts: initialPosts,
  pageTitle,
  pageDescription,
  backLink,
  backLabel,
  emptyStateText,
  iconName,
}: PostListClientPageProps) {
  const [postList, setPostList] = useState<Post[]>(initialPosts);
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    setPostList(initialPosts);
  }, [initialPosts]);

  const handlePostDeleted = (postId: string) => {
    setPostList(prevList => prevList.filter(post => post.id !== postId));
  };
  
  const Icon = iconMap[iconName] || iconMap.default;

  return (
    <div className="container mx-auto max-w-xl py-8">
      <Button variant="ghost" onClick={() => navigateBack(router, { targetUrl: backLink })} className="mb-6 text-sm">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {backLabel}
      </Button>
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center text-xl">
            <Icon className="mr-3 h-6 w-6 text-primary" />
            {pageTitle}
          </CardTitle>
          <CardDescription>{pageDescription}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {postList.length > 0 ? (
            <div className="border-t border-border">
              {postList.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onPostDeleted={handlePostDeleted}
                  isSinglePostView={false} // Quotes in a list are not single post views
                />
              ))}
            </div>
          ) : (
            <p className="p-6 text-center text-muted-foreground">
              {emptyStateText}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
