// src/components/feed/FloatingCommentBar.tsx
'use client';

import { DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ViewerSummary } from '@/contexts/CurrentUserContext';

interface FloatingCommentBarProps {
  user: ViewerSummary;
}

export default function FloatingCommentBar({ user }: FloatingCommentBarProps) {
  return (
    // Acompanha a navegação inferior ao rolar: `.chrome-float` (globals.css) é movido por CSS, sem estado nem ouvinte próprio.
    <div className="chrome-float chrome-surface fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 h-14 border-t border-border shadow-md md:hidden z-30">
      <DialogTrigger asChild>
        <div className="flex items-center space-x-3 p-2 h-full cursor-pointer group" data-interactive="true">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatarUrl} alt={user.name} data-ai-hint={user["data-ai-hint"] || "person avatar"} />
            <AvatarFallback>{user.name?.substring(0,1) || 'Me'}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Escreva um comentário...</p>
          </div>
        </div>
      </DialogTrigger>
    </div>
  );
}
