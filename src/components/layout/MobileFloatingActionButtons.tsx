// src/components/layout/MobileFloatingActionButtons.tsx
'use client';

import React from 'react';
import { FilePlus2, MessageSquarePlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { User, Post } from '@/lib/types';
import CreatePostDialogContent from '@/components/feed/CreatePostDialogContent';
import CreateNewsDialogContent from '@/components/feed/CreateNewsDialogContent';
import { triggerHapticFeedback } from '@/lib/utils';

interface MobileFloatingActionButtonsProps {
  currentUser: User | null | undefined;
  isLoadingCurrentUser: boolean;
  isCreatePostDialogOpen: boolean;
  setIsCreatePostDialogOpen: (open: boolean) => void;
  isCreateNewsDialogOpen: boolean;
  setIsCreateNewsDialogOpen: (open: boolean) => void;
  onPostCreated: (newPost: Post) => void;
  setShowLoginPrompt: (show: boolean) => void;
  setPromptActionName: (action: string) => void;
  clientHasMounted: boolean; // To prevent hydration mismatches
}

const MobileFloatingActionButtons: React.FC<MobileFloatingActionButtonsProps> = ({
  currentUser,
  isLoadingCurrentUser,
  isCreatePostDialogOpen,
  setIsCreatePostDialogOpen,
  isCreateNewsDialogOpen,
  setIsCreateNewsDialogOpen,
  onPostCreated,
  setShowLoginPrompt,
  setPromptActionName,
  clientHasMounted
}) => {
  const handleFabClick = () => {
    triggerHapticFeedback();
  };

  if (!clientHasMounted) { // Or use skeleton if prefered for initial non-render
    return (
        <div className="fixed bottom-[calc(4rem+1rem)] right-4 md:hidden z-50 flex flex-col-reverse items-end space-y-3 space-y-reverse">
            <Skeleton className="rounded-full w-12 h-12 shadow-lg" />
            <Skeleton className="rounded-full w-12 h-12 shadow-lg" />
        </div>
    );
  }

  if (isLoadingCurrentUser) {
    return (
        <div className="fixed bottom-[calc(4rem+1rem)] right-4 md:hidden z-50 flex flex-col-reverse items-end space-y-3 space-y-reverse">
            <Skeleton className="rounded-full w-12 h-12 shadow-lg" />
            <Skeleton className="rounded-full w-12 h-12 shadow-lg" />
        </div>
    );
  }

  return (
    <div className="fixed bottom-[calc(4rem+1rem)] right-4 md:hidden z-50 flex flex-col-reverse items-end space-y-3 space-y-reverse">
      {currentUser ? (
        <>
          <Dialog open={isCreatePostDialogOpen} onOpenChange={setIsCreatePostDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="default"
                size="icon"
                className="rounded-full w-12 h-12 shadow-lg bg-primary hover:bg-primary/90"
                onClick={handleFabClick}
              >
                <MessageSquarePlus size={24} /> <span className="sr-only">Post</span>
              </Button>
            </DialogTrigger>
            <CreatePostDialogContent onPostCreated={onPostCreated} dialogClose={() => setIsCreatePostDialogOpen(false)} />
          </Dialog>
          <Dialog open={isCreateNewsDialogOpen} onOpenChange={setIsCreateNewsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full w-12 h-12 shadow-lg bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleFabClick}
              >
                <FilePlus2 size={24} /><span className="sr-only">Article</span>
              </Button>
            </DialogTrigger>
            <CreateNewsDialogContent onPostCreated={onPostCreated} dialogClose={() => setIsCreateNewsDialogOpen(false)} />
          </Dialog>
        </>
      ) : null /* Explicitamente não renderizar nada se não houver currentUser */ }
    </div>
  );
};

export default MobileFloatingActionButtons;
