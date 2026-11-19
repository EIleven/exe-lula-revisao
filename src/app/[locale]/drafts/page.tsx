// src/app/[locale]/drafts/page.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import BackButton from '@/components/shared/BackButton';
import DraftsList from '@/components/drafts/DraftsList';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Edit, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

export default function DraftsPage() {
  const t = useTranslations('DraftsPage');
  const locale = useLocale();
  const { currentUser, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-3xl py-8 space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="container mx-auto max-w-xl py-8 px-4">
        <Card className="shadow-lg rounded-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <Lock className="h-5 w-5 text-primary" />
              {t('title')}
            </CardTitle>
            <CardDescription>
              Entre na sua conta para acessar seus rascunhos salvos.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/${locale}/login?redirect=/${locale}/drafts`}>Entrar</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/${locale}`}>Voltar ao Feed</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <div className="flex justify-between items-center mb-6 px-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold flex items-center">
            <Edit className="mr-3 h-6 w-6 text-primary" />
            {t('title')}
          </h1>
        </div>
        <BackButton />
      </div>
      <Card className="shadow-lg rounded-none border-x-0">
        <CardContent className="p-0">
          <DraftsList />
        </CardContent>
      </Card>
    </div>
  );
}
