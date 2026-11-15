// src/app/[locale]/settings/account/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import AccountSettings from '@/components/settings/AccountSettings';
import BackButton from '@/components/shared/BackButton';
import { useTranslations } from 'next-intl';

export default function AccountSettingsPage() {
  const t = useTranslations('AccountSettings');
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
        <AccountSettings user={currentUser} />
      </Card>
    </div>
  );
}
