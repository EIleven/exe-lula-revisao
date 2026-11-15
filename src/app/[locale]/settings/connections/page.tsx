'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import BackButton from '@/components/shared/BackButton';
import SocialConnectionsSettings from '@/components/settings/SocialConnectionsSettings';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

export default function ConnectionsSettingsPage() {
  const { currentUser, isLoading } = useCurrentUser();
  return (
    <div className="container mx-auto max-w-xl py-8">
      <BackButton />
      {isLoading || !currentUser ? <Skeleton className="h-[34rem] w-full" /> : <Card className="overflow-hidden"><SocialConnectionsSettings /></Card>}
    </div>
  );
}
