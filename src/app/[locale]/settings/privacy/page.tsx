// src/app/[locale]/settings/privacy/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import PrivacySecuritySettings from '@/components/settings/PrivacySecuritySettings';
import BackButton from '@/components/shared/BackButton';

export default function PrivacySettingsPage() {
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
        <PrivacySecuritySettings user={currentUser} />
      </Card>
    </div>
  );
}
