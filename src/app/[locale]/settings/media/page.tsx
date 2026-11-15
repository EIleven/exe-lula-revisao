// src/app/[locale]/settings/media/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import MediaSettings from '@/components/settings/MediaSettings'; // Import the new component

export default function MediaSettingsPage() {
  const { currentUser, isLoading } = useCurrentUser();

  if (isLoading || !currentUser) {
    return (
      <div className="container mx-auto max-w-xl py-8">
        <BackButton />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-xl py-8">
      <BackButton />
      <Card>
        <MediaSettings user={currentUser} />
      </Card>
    </div>
  );
}
