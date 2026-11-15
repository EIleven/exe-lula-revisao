// src/components/composer/LocationButton.tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Search } from 'lucide-react';
import type { PostLocation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { searchMunicipalities, type Municipality } from '@/lib/location/municipios';

interface LocationButtonProps {
  value: PostLocation | null;
  onChange: (location: PostLocation | null) => void;
  disabled?: boolean;
}

const MAX_RESULTS = 40;

/**
 * Localização do post: a pessoa escolhe o MUNICÍPIO numa lista do IBGE (gravada no app, sem GPS e sem consulta a serviço
 * externo). A localização do post é só "Cidade, UF"; nunca a posição do aparelho.
 */
export default function LocationButton({ value, onChange, disabled }: LocationButtonProps) {
  const t = useTranslations('Composer');
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Municipality[]>([]);
  const [loading, setLoading] = useState(false);

  // A lista (uns 170 KB) só é baixada quando a pessoa começa a procurar.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void searchMunicipalities(query, MAX_RESULTS).then((found) => {
      if (!alive) return;
      setResults(found);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, query]);

  const choose = (municipality: Municipality) => {
    onChange({ name: municipality.name, state: municipality.state, ibgeId: municipality.id });
    setOpen(false);
    setQuery('');
  };

  const panel = (
    <div className="flex flex-col gap-2" data-testid="composer-location-panel">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('locationSearch')}
          aria-label={t('locationSearch')}
          className="pl-9"
          autoComplete="off"
          data-testid="composer-location-search"
        />
      </div>
      <p className="px-1 text-xs text-muted-foreground">{t('locationHint')}</p>
      <ul className="max-h-64 overflow-y-auto rounded-md border" role="listbox" aria-label={t('locationButton')}>
        {loading && results.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('locationLoading')}</li>}
        {!loading && results.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('locationNone')}</li>}
        {results.map((municipality) => (
          <li key={municipality.id} role="option" aria-selected={value?.ibgeId === municipality.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-muted [touch-action:manipulation]"
              onClick={() => choose(municipality)}
              data-testid="composer-location-option"
            >
              <span>{municipality.name}</span>
              <span className="text-xs text-muted-foreground">{municipality.state}</span>
            </button>
          </li>
        ))}
      </ul>
      {value && (
        <Button type="button" variant="ghost" size="sm" className="self-start text-destructive" onClick={() => { onChange(null); setOpen(false); }}>
          {t('locationRemove')}
        </Button>
      )}
    </div>
  );

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={value ? 'h-8 w-8 bg-primary/10 text-primary' : 'h-8 w-8 text-primary'}
      aria-label={t('locationButton')}
      aria-pressed={!!value}
      title={t('locationButton')}
      disabled={disabled}
      data-testid="composer-location-button"
    >
      <MapPin className="h-5 w-5" />
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-lg p-4 pt-8">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('locationButton')}</SheetTitle>
            <SheetDescription>{t('locationHint')}</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-3">
        {panel}
      </PopoverContent>
    </Popover>
  );
}
