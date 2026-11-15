// src/components/settings/AppearanceSettings.tsx

'use client';

import React, { useState } from 'react';
import { useTheme } from 'next-themes';
import type { User } from '@/lib/types';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Monitor, Moon, Sun, Check, RotateCcw, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { updateUserSettings } from '@/lib/services/userService';
import { useToast } from '@/hooks/use-toast';
import { PROFILE_ACCENT_PRESETS, isValidHexColor } from '@/lib/utils/themeColor';
import { cn } from '@/lib/utils';

interface SettingsProps {
  user: User;
}

export default function AppearanceSettings({ user }: SettingsProps) {
  const t = useTranslations('AppearanceSettings');
  const { theme, setTheme } = useTheme();
  const { refreshCurrentUser } = useCurrentUser();
  const { toast } = useToast();
  const [selectedColor, setSelectedColor] = useState<string>(
    isValidHexColor(user.accentColor) ? user.accentColor : '#2563eb'
  );
  const [isSavingColor, setIsSavingColor] = useState(false);

  const handleSaveAccentColor = async (nextColor: string | null) => {
    setIsSavingColor(true);
    try {
      await updateUserSettings(user.id, { accentColor: nextColor });
      if (nextColor) {
        setSelectedColor(nextColor);
      } else {
        setSelectedColor('#2563eb');
      }
      await refreshCurrentUser();
      toast({
        title: 'Cor do perfil atualizada',
        description: nextColor
          ? 'Quem visitar o seu perfil verá a nova cor escolhida.'
          : 'A cor padrão do Exe. Lula foi restaurada no seu perfil.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar cor',
        description: error?.message || 'Não foi possível atualizar a cor do perfil.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingColor(false);
    }
  };

  return (
    <>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div>
          <Label className="text-base font-semibold">{t('theme.label')}</Label>
          <p className="text-sm text-muted-foreground mb-4">
            {t('theme.description')}
          </p>
          <RadioGroup
            defaultValue={theme}
            onValueChange={setTheme}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            <Label htmlFor="light" className="border rounded-md p-4 flex flex-col items-center justify-center space-y-2 cursor-pointer [&:has([data-state=checked])]:border-primary">
              <RadioGroupItem value="light" id="light" className="sr-only" />
              <Sun className="h-6 w-6" />
              <span>{t('theme.light')}</span>
            </Label>
            <Label htmlFor="dark" className="border rounded-md p-4 flex flex-col items-center justify-center space-y-2 cursor-pointer [&:has([data-state=checked])]:border-primary">
              <RadioGroupItem value="dark" id="dark" className="sr-only" />
              <Moon className="h-6 w-6" />
              <span>{t('theme.dark')}</span>
            </Label>
            <Label htmlFor="system" className="border rounded-md p-4 flex flex-col items-center justify-center space-y-2 cursor-pointer [&:has([data-state=checked])]:border-primary">
              <RadioGroupItem value="system" id="system" className="sr-only" />
              <Monitor className="h-6 w-6" />
              <span>{t('theme.system')}</span>
            </Label>
          </RadioGroup>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label className="text-base font-semibold">Cor do perfil</Label>
              <p className="text-sm text-muted-foreground">
                Substitua o azul padrão por qualquer cor. Outros usuários verão essa cor ao visitar o seu perfil.
              </p>
            </div>
            {user.accentColor && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSavingColor}
                onClick={() => handleSaveAccentColor(null)}
              >
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Restaurar padrão
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {PROFILE_ACCENT_PRESETS.map((preset) => {
              const isSelected = selectedColor.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.hex}
                  type="button"
                  title={preset.name}
                  disabled={isSavingColor}
                  onClick={() => handleSaveAccentColor(preset.hex)}
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center border-2 transition-transform hover:scale-110',
                    isSelected ? 'border-foreground scale-110' : 'border-transparent'
                  )}
                  style={{ backgroundColor: preset.hex }}
                  aria-label={preset.name}
                >
                  {isSelected && <Check className="h-4 w-4 text-white drop-shadow" />}
                </button>
              );
            })}

            <label className="flex items-center gap-2 border border-border rounded-full px-3 py-1.5 cursor-pointer hover:bg-muted/50 text-sm">
              <input
                type="color"
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                className="h-5 w-5 rounded-full border-0 bg-transparent p-0 cursor-pointer"
                aria-label="Escolher cor personalizada"
              />
              <span>Personalizada</span>
            </label>

            <Button
              type="button"
              size="sm"
              disabled={isSavingColor || selectedColor.toLowerCase() === (user.accentColor || '#2563eb').toLowerCase()}
              onClick={() => handleSaveAccentColor(selectedColor)}
              style={{ backgroundColor: selectedColor, color: '#ffffff' }}
            >
              {isSavingColor ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Aplicar cor
            </Button>
          </div>
        </div>
      </CardContent>
    </>
  );
}
