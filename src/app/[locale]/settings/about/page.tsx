// src/app/[locale]/settings/about/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import AboutSettings from '@/components/settings/AboutSettings';
import BackButton from '@/components/shared/BackButton';

export default function AboutSettingsPage() {
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
        <AboutSettings user={currentUser} />
      </Card>
    </div>
  );
}
