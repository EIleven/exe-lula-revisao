'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import BackButton from '@/components/shared/BackButton';
import SocialConnectionsSettings from '@/components/settings/SocialConnectionsSettings';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

export default function ConnectionsSettingsPage() {
  const { currentUser, isLoading } = useCurrentUser();
  const locale = useLocale();
  return (
    <div className="container mx-auto max-w-xl py-8">
      <BackButton />
      {isLoading ? (
        <Skeleton className="h-[34rem] w-full" />
      ) : !currentUser ? (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-foreground">
            Entre na sua conta para gerenciar conexões externas.
          </p>
          <Button asChild size="sm">
            <Link href={`/${locale}/login`}>Ir para o Login</Link>
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden"><SocialConnectionsSettings /></Card>
      )}
    </div>
  );
}
