// src/components/composer/EmojiButton.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Smile } from 'lucide-react';
import type { EmojiClickData, EmojiStyle, Theme, Categories } from 'emoji-picker-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

// O seletor só é baixado quando a pessoa abre (a biblioteca é grande) e NÃO existe no servidor.
const Picker = dynamic(() => import('emoji-picker-react'), { ssr: false, loading: () => <Skeleton className="h-[340px] w-full" /> });

// Valores dos enums da biblioteca, em texto: importar os enums de verdade traria a biblioteca inteira para o pacote da tela.
const NATIVE = 'native' as EmojiStyle; // desenha o emoji do próprio aparelho: nenhuma imagem de CDN é pedida
const DARK = 'dark' as Theme;
const LIGHT = 'light' as Theme;

interface EmojiButtonProps {
  /** Recebe o emoji escolhido (o seletor continua aberto: dá para escolher vários). */
  onPick: (emoji: string) => void;
  disabled?: boolean;
}

/**
 * Botão de emoji do compositor. No computador abre um balão; no celular, uma folha de baixo (que se fecha puxando a alça).
 * O emoji é desenhado pelo sistema (sem baixar imagens) e os recentes ficam guardados no aparelho.
 */
export default function EmojiButton({ onPick, disabled }: EmojiButtonProps) {
  const t = useTranslations('Composer');
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const picker = (
    <Picker
      onEmojiClick={(emoji: EmojiClickData) => onPick(emoji.emoji)}
      emojiStyle={NATIVE}
      theme={resolvedTheme === 'light' ? LIGHT : DARK}
      width="100%"
      height={isMobile ? 380 : 340}
      lazyLoadEmojis
      autoFocusSearch={false}
      previewConfig={{ showPreview: false }}
      searchPlaceholder={t('emojiSearch')}
      categories={[
        { category: 'suggested' as Categories, name: t('emojiRecent') },
        { category: 'smileys_people' as Categories, name: t('emojiSmileys') },
        { category: 'animals_nature' as Categories, name: t('emojiAnimals') },
        { category: 'food_drink' as Categories, name: t('emojiFood') },
        { category: 'travel_places' as Categories, name: t('emojiTravel') },
        { category: 'activities' as Categories, name: t('emojiActivities') },
        { category: 'objects' as Categories, name: t('emojiObjects') },
        { category: 'symbols' as Categories, name: t('emojiSymbols') },
        { category: 'flags' as Categories, name: t('emojiFlags') },
      ]}
    />
  );

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-primary"
      aria-label={t('emojiButton')}
      title={t('emojiButton')}
      disabled={disabled}
      data-testid="composer-emoji-button"
    >
      <Smile className="h-5 w-5" />
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-lg p-3 pt-8" data-testid="composer-emoji-panel">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('emojiButton')}</SheetTitle>
            <SheetDescription>{t('emojiSheetDescription')}</SheetDescription>
          </SheetHeader>
          {picker}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[340px] p-0 border-0 bg-transparent shadow-none" data-testid="composer-emoji-panel">
        {picker}
      </PopoverContent>
    </Popover>
  );
}
