// src/components/settings/MediaSettings.tsx
'use client';

import React, { useEffect, useState } from 'react';
import type { User } from '@/lib/types';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { updateUserSettings } from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

interface SettingsProps {
  user: User;
}

export default function MediaSettings({ user }: SettingsProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [displaySensitive, setDisplaySensitive] = useState<boolean>(user.displaySensitiveContent === true);
  const [isUpdating, setIsUpdating] = useState(false);

  // Sincroniza quando o perfil privado (`users/{uid}/private/account`) termina de carregar ou muda em outra aba.
  useEffect(() => {
    setDisplaySensitive(user.displaySensitiveContent === true);
  }, [user.displaySensitiveContent]);

  const handleToggleSensitive = async (checked: boolean) => {
    if (isUpdating) return;
    const previous = displaySensitive;
    setDisplaySensitive(checked);
    setIsUpdating(true);
    try {
      await updateUserSettings(user.id, { displaySensitiveContent: checked });
      toast({
        title: checked ? 'Mídias sensíveis visíveis' : 'Mídias sensíveis protegidas',
        description: checked
          ? 'Posts, comentários e mídias do Fediverso marcados como sensíveis serão exibidos automaticamente.'
          : 'Mídias marcadas como sensíveis ficarão ocultas até você tocar em "Mostrar mídia".',
      });
      await refreshCurrentUser();
    } catch (error: unknown) {
      setDisplaySensitive(previous);
      toast({
        title: 'Não foi possível salvar',
        description: error instanceof Error ? error.message : 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <CardHeader>
        <CardTitle>Conteúdo e Mídia</CardTitle>
        <CardDescription>
          Controle em 1 toque como imagens e vídeos marcados como conteúdo sensível aparecem no feed, nos comentários e no Fediverso.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="display-sensitive-switch" className="text-base font-medium cursor-pointer">
                Exibir conteúdo sensível automaticamente
              </Label>
              <Badge
                variant={displaySensitive ? 'default' : 'secondary'}
                className="gap-1 text-[11px]"
                data-testid="sensitive-setting-status"
              >
                {displaySensitive ? (
                  <>
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    Visível
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3 w-3" aria-hidden="true" />
                    Oculto por padrão
                  </>
                )}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Quando desativado, mídias sensíveis em publicações, respostas, citações e perfis do Fediverso ficam cobertas até você tocar para ver.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            {isUpdating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
            <Switch
              id="display-sensitive-switch"
              data-testid="display-sensitive-switch"
              checked={displaySensitive}
              disabled={isUpdating}
              onCheckedChange={handleToggleSensitive}
            />
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3.5 py-3 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
          <p>
            Ao publicar ou comentar com fotos e vídeos, você pode marcar a mídia como sensível pelo ícone de alerta no compositor — essa flag também é enviada e recebida na federação ActivityPub.
          </p>
        </div>
      </CardContent>
    </>
  );
}
