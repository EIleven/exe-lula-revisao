// src/app/[locale]/search/page.tsx
'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock, Search, Trash2, X } from 'lucide-react';
import SearchResultsTabs from '@/components/search/SearchResultsTabs';
import PainelDeBuscaAvancada from '@/components/search/PainelDeBuscaAvancada';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { usePreferenciasDeBusca } from '@/hooks/usePreferenciasDeBusca';
import { useLocale, useTranslations } from 'next-intl';

function SearchPageContent() {
  const t = useTranslations('SearchPage');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const { currentUser } = useCurrentUser();
  const { historico, registrar, limpar, esquecer } = usePreferenciasDeBusca(currentUser?.id);

  // O historico e gravado SO no aparelho (ver lib/search/preferenciasDeBusca.ts) e so quando a pessoa deixou a
  // opcao ligada. Nada disso vai para o servidor.
  useEffect(() => {
    if (query.trim().length >= 2) registrar(query.trim());
  }, [query, registrar]);

  const irPara = (nova: string) => {
    const limpa = nova.trim();
    router.replace(limpa ? `/${locale}/search?q=${encodeURIComponent(limpa)}` : `/${locale}/search`);
  };

  return (
    <div>
      {query ? (
        <>
          <h1 className="text-2xl font-bold mb-4 ml-4">
            {t('resultsFor')}: <span className="text-primary">&quot;{query}&quot;</span>
          </h1>
          <PainelDeBuscaAvancada consulta={query} aoMudar={irPara} />
          <SearchResultsTabs query={query} />
        </>
      ) : (
        <div className="py-10">
            <div className="text-center">
              <Search className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">{t('prompt')}</p>
            </div>
            {historico.length > 0 && (
              <div className="mx-auto mt-8 max-w-md">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Buscas recentes
                  </p>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={limpar}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Limpar
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {historico.map((h) => (
                    <span key={h} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-xs">
                      <button type="button" className="truncate hover:underline" onClick={() => irPara(h)}>{h}</button>
                      <button
                        type="button"
                        onClick={() => esquecer(h)}
                        aria-label={`Esquecer a busca ${h}`}
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
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
