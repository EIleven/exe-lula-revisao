// src/components/feed/AdPostCard.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import AdClientComponent from '../shared/AdClientComponent'; // Changed path
import { Badge } from '@/components/ui/badge';

const adUser = {
  id: 'xjc1yPNwYSS3t5hlxqlr0HM9veC3',
  name: 'Publicidade',
  username: 'Publicidade',
  avatarUrl: 'https://placehold.co/100x100.png',
  'data-ai-hint': 'logo brand',
};

export default function AdPostCard() {
  return (
    <Card className="w-full rounded-none border-b border-x-0 overflow-hidden bg-card relative">
      <div className="flex items-start space-x-3 p-4">
        <div className="shrink-0">
          <Link href={`/profile/${adUser.id}`} className="cursor-pointer" data-interactive="true">
            <Avatar className="h-10 w-10">
              <AvatarImage src={adUser.avatarUrl} alt={adUser.name} data-ai-hint={adUser['data-ai-hint']} />
              <AvatarFallback>{adUser.name?.substring(0, 1)?.toUpperCase() || 'A'}</AvatarFallback>
            </Avatar>
          </Link>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <Link href={`/profile/${adUser.id}`} className="cursor-pointer hover:underline" data-interactive="true">
                <p className="text-sm font-semibold text-foreground truncate">{adUser.name}</p>
              </Link>
              <p className="text-xs text-muted-foreground">
                <Link href={`/profile/${adUser.id}`} className="cursor-pointer hover:underline" data-interactive="true">
                  @{adUser.username}
                </Link>
              </p>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            <AdClientComponent adSlot="9625426118" />
          </div>
        </div>
      </div>
      <Badge variant="outline" className="absolute top-3 right-3 text-xs">Patrocinado</Badge>
    </Card>
  );
}
