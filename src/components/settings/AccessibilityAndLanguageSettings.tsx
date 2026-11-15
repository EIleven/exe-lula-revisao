// src/components/settings/AccessibilityAndLanguageSettings.tsx
'use client';

import React, { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useTheme } from 'next-themes';

interface SettingsProps {
  user: User;
  pageContext: 'accessibility' | 'languages';
}

const FONT_SIZE_STORAGE_KEY = 'soberan-font-size';
const DEFAULT_FONT_SIZE = 16; // Default base font size in pixels

export default function AccessibilityAndLanguageSettings({ user, pageContext }: SettingsProps) {
  const t = useTranslations('AccessibilitySettings');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [clientHasMounted, setClientHasMounted] = useState(false);
  
  // Load settings from localStorage on mount
  useEffect(() => {
    setClientHasMounted(true);

    const storedFontSize = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (storedFontSize) {
      const size = parseInt(storedFontSize, 10);
      if (!isNaN(size)) {
        setFontSize(size);
        document.documentElement.style.fontSize = `${size}px`;
      }
    }
    
    // Theme is managed by next-themes, which handles localStorage automatically.
    // We just need to sync our switch state with it.
    setIsHighContrast(theme === 'high-contrast');
    
  }, [theme]);


  const handleLocaleChange = (newLocale: string) => {
    const currentPathWithoutLocale = pathname.replace(`/${locale}`, '');
    const newPath = `/${newLocale}${currentPathWithoutLocale}`;
    router.push(newPath);
  };

  const handleFontSizeChange = (value: number[]) => {
    const newSize = value[0];
    setFontSize(newSize);
    document.documentElement.style.fontSize = `${newSize}px`;
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(newSize));
  };
  
  const handleHighContrastToggle = (checked: boolean) => {
    setIsHighContrast(checked);
    if (checked) {
      setTheme('high-contrast');
    } else {
      // Revert to the default theme (e.g., 'dark') or a previously stored one
      setTheme('dark'); 
    }
  };


  const title = pageContext === 'accessibility' ? t('accessibilityTitle') : t('languageTitle');
  const description = pageContext === 'accessibility' ? t('accessibilityDescriptionPage') : t('languageDescription');

  return (
    <>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        
        <div className="space-y-2">
            <h3 className="text-base font-semibold">{t('languageLabel')}</h3>
            <p className="text-sm text-muted-foreground">
                {t('languageDescription')}
            </p>
            <Select value={locale} onValueChange={handleLocaleChange}>
                <SelectTrigger id="language-select" className="w-[280px]">
                <SelectValue placeholder={t('selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                <SelectItem value="en">English</SelectItem>
                </SelectContent>
            </Select>
        </div>

        <Separator />
        
        <div className="space-y-6">
            <h3 className="text-base font-semibold">{t('displayTitle')}</h3>
            
            <div className="space-y-2">
                 <Label htmlFor="font-size-slider">{t('fontSize')}</Label>
                 <div className="flex items-center gap-4">
                    <span className="text-xs">Pequeno</span>
                    <Slider
                        id="font-size-slider"
                        min={12}
                        max={20}
                        step={1}
                        value={[fontSize]}
                        onValueChange={handleFontSizeChange}
                        className="w-[150px]"
                    />
                     <span className="text-lg">Grande</span>
                 </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
                 <div className="space-y-0.5">
                    <Label htmlFor="high-contrast-switch" className="text-base">{t('highContrast')}</Label>
                    <p className="text-sm text-muted-foreground">{t('highContrastDescription')}</p>
                </div>
                {clientHasMounted && (
                  <Switch
                      id="high-contrast-switch"
                      checked={isHighContrast}
                      onCheckedChange={handleHighContrastToggle}
                  />
                )}
            </div>
        </div>
      </CardContent>
    </>
  );
}
