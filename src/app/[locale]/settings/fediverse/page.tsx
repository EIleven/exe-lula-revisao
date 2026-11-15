'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import BackButton from '@/components/shared/BackButton';
import FediverseSettings from '@/components/settings/FediverseSettings';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

export default function FediverseSettingsPage() {
  const { currentUser, isLoading } = useCurrentUser();
  return (
    <div className="container mx-auto max-w-xl px-3 py-6 sm:px-4 sm:py-8">
      <BackButton />
      {isLoading || !currentUser ? <Skeleton className="h-[34rem] w-full" /> : <Card className="overflow-hidden"><FediverseSettings /></Card>}
    </div>
  );
}
