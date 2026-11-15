// src/app/[locale]/drafts/page.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import DraftsList from '@/components/drafts/DraftsList';
import { Edit } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function DraftsPage() {
  const t = useTranslations('DraftsPage');

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
