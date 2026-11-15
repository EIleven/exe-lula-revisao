'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import BackButton from '@/components/shared/BackButton';
import P2pSettings from '@/components/settings/P2pSettings';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

export default function P2pSettingsPage() {
  const { currentUser, isLoading } = useCurrentUser();
  return (
    <div className="container mx-auto max-w-xl px-3 py-6 sm:px-4 sm:py-8">
      <BackButton />
      {isLoading || !currentUser ? (
        <Skeleton className="h-[28rem] w-full" />
      ) : (
        <Card className="overflow-hidden">
          <P2pSettings />
        </Card>
      )}
    </div>
  );
}

