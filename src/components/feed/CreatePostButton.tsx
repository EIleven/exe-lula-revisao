// src/components/feed/CreatePostButton.tsx
'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import dynamic from 'next/dynamic';
import { MessageSquarePlus } from 'lucide-react';
import type { Post } from '@/lib/types';
import { getCurrentUserId } from '@/lib/services/authService';
import { useRouter } from 'next/navigation'; // Import useRouter

// Dynamically import the dialog content to reduce initial bundle size
const CreatePostDialogContent = dynamic(() => import('./CreatePostDialogContent'), {
  ssr: false, 
});

interface CreatePostButtonProps {
  onPostCreated?: (newPost: Post) => void;
  fullWidth?: boolean;
}

export default function CreatePostButton({ onPostCreated, fullWidth = false }: CreatePostButtonProps) {
  const currentUserId = getCurrentUserId();
  const router = useRouter(); // Initialize router

  if (!currentUserId) {
    return (
      <Button 
        className={fullWidth ? "w-full" : ""}
        onClick={() => router.push('/login')} // Redirect to login
      >
        <MessageSquarePlus className="mr-2 h-5 w-5" />
        Post (Login Required)
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className={fullWidth ? "w-full" : ""}>
          <MessageSquarePlus className="mr-2 h-5 w-5" />
          Post
        </Button>
      </DialogTrigger>
      <CreatePostDialogContent onPostCreated={onPostCreated} />
    </Dialog>
  );
}
