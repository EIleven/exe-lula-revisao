// src/app/[locale]/settings/notifications/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import NotificationsSettings from '@/components/settings/NotificationsSettings';
import BackButton from '@/components/shared/BackButton';

export default function NotificationsSettingsPage() {
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
        <NotificationsSettings user={currentUser} />
      </Card>
    </div>
  );
}
