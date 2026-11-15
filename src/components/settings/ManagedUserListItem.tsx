// src/components/settings/ManagedUserListItem.tsx
'use client';

import React from 'react';
import type { User } from '@/lib/types';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useLocale } from 'next-intl';

interface ManagedUserListItemProps {
  user: User;
  actionLabel: string;
  onAction: () => void;
  isProcessing: boolean;
}

export default function ManagedUserListItem({
  user,
  actionLabel,
  onAction,
  isProcessing,
}: ManagedUserListItemProps) {
  const locale = useLocale();

  return (
    <div className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md">
      <Link href={`/${locale}/profile/${user.id}`} className="flex items-center space-x-3 group flex-1 min-w-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={user.avatarUrl} alt={user.name} data-ai-hint={user['data-ai-hint'] || 'person avatar'} />
          <AvatarFallback>{user.name?.substring(0, 1) || '?'}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-medium group-hover:underline text-foreground truncate">{user.name}</p>
          <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
        </div>
      </Link>
      <Button
        variant="outline"
        size="sm"
        onClick={onAction}
        disabled={isProcessing}
        className="ml-4"
      >
        {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : actionLabel}
      </Button>
    </div>
  );
}
