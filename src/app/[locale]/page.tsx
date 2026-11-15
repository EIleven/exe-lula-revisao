
'use client';

import React, { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import HomeFeedTabs from '@/components/feed/HomeFeedTabs';
import PushPrompt from '@/components/notifications/PushPrompt';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import type { Post } from '@/lib/types';

interface HomePageProps {
  onPostCreated?: (newPost: Post) => void; // This will be injected by AppLayout
}

export default function HomePage({ onPostCreated }: HomePageProps) {
  const [newlyCreatedPostForFeed, setNewlyCreatedPostForFeed] = useState<Post | null>(null);
  const { currentUser } = useCurrentUser();

  useEffect(() => {
    // This is a workaround to use the onPostCreated prop from AppLayout
    // In a real app, a more robust state management solution like Context or Redux would be better
    if (onPostCreated) {
        (window as any).handleGlobalPostCreation = (newPost: Post) => {
            setNewlyCreatedPostForFeed(newPost);
        };
    }
    return () => {
        delete (window as any).handleGlobalPostCreation;
    }
  }, [onPostCreated]);
  
  const handlePostPrepended = () => {
    setNewlyCreatedPostForFeed(null);
  };

  return (
    <main className="w-full min-w-0">
      {/* Convite para ligar os avisos do aparelho: a tela inicial é onde a maioria entra (some por 14 dias em "Agora não"). */}
      {currentUser?.id && <PushPrompt userId={currentUser.id} className="mt-3" />}
      <HomeFeedTabs
        newPostToPrepend={newlyCreatedPostForFeed}
        onPostPrepended={handlePostPrepended}
      />
    </main>
  );
}
