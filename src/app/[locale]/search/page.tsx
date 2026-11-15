// src/app/[locale]/search/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import SearchResultsTabs from '@/components/search/SearchResultsTabs';
import { useTranslations } from 'next-intl';

function SearchPageContent() {
  const t = useTranslations('SearchPage');
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';

  return (
    <div>
      {query ? (
        <>
          <h1 className="text-2xl font-bold mb-6 ml-4">
            {t('resultsFor')}: <span className="text-primary">&quot;{query}&quot;</span>
          </h1>
          <SearchResultsTabs query={query} />
        </>
      ) : (
        <div className="text-center py-10">
            <Search className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">{t('prompt')}</p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
    const t = useTranslations('SearchPage');
    return (
        <Suspense fallback={<div className="text-center p-8">{t('loading')}</div>}>
            <div className="container mx-auto max-w-3xl py-8">
              <SearchPageContent />
            </div>
        </Suspense>
    )
}
