// src/components/recommendations/RecommendationSettingsDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import type { RecommendationPreferences } from '@/lib/types';
import {
  DEFAULT_RECOMMENDATION_PREFERENCES,
  persistLocalRecommendationPreferences,
  readRecommendationPreferences,
} from '@/lib/recommendations/preferences';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { updateUserSettings } from '@/lib/services/userService';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface RecommendationSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RecommendationSettingsDialog({
  open,
  onOpenChange,
}: RecommendationSettingsDialogProps) {
  const { currentUser, refreshCurrentUser } = useCurrentUser();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<RecommendationPreferences>(() =>
    readRecommendationPreferences(currentUser),
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPrefs(readRecommendationPreferences(currentUser));
    }
  }, [open, currentUser]);

  const applyUpdate = async (next: RecommendationPreferences, silent = false) => {
    setPrefs(next);
    persistLocalRecommendationPreferences(next);

    if (!currentUser?.id) return;
    setIsSaving(true);
    try {
      await updateUserSettings(currentUser.id, { recommendationPreferences: next });
      await refreshCurrentUser();
      if (!silent) {
        toast({
          title: 'Preferências atualizadas',
          description: next.enabled
            ? 'O algoritmo de sugestões foi ajustado às suas escolhas.'
            : 'Sugestões de perfis desativadas.',
        });
      }
    } catch {
      toast({
        title: 'Erro ao salvar preferências',
        description: 'As alterações foram aplicadas apenas nesta sessão.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = (key: keyof RecommendationPreferences) => {
    void applyUpdate({ ...prefs, [key]: !prefs[key] }, true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Algoritmo de Sugestões
          </DialogTitle>
          <DialogDescription>
            Você decide se quer recomendações e exatamente quais sinais podem ser analisados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          {/* Ativação principal */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="rec-enabled" className="font-semibold">Mostrar sugestões de perfis</Label>
                <p className="text-xs text-muted-foreground">Exibe &ldquo;Contas Sugeridas&rdquo; na rede.</p>
              </div>
              <Switch
                id="rec-enabled"
                checked={prefs.enabled}
                disabled={isSaving}
                onCheckedChange={() => toggle('enabled')}
              />
            </div>

            {prefs.enabled && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/60">
                <div>
                  <Label htmlFor="rec-profiles" className="font-medium">Relacionados ao visitar perfis</Label>
                  <p className="text-xs text-muted-foreground">Mostra contas afins logo abaixo do perfil.</p>
                </div>
                <Switch
                  id="rec-profiles"
                  checked={prefs.showOnProfiles}
                  disabled={isSaving}
                  onCheckedChange={() => toggle('showOnProfiles')}
                />
              </div>
            )}
          </div>

          {prefs.enabled && (
            <>
              {/* Sinais permitidos */}
              <div className="space-y-2.5 rounded-lg border border-border p-3">
                <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Dados que você permite analisar
                </p>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="rec-following">Quem você segue</Label>
                    <p className="text-xs text-muted-foreground">Conexões em comum e reciprocidade.</p>
                  </div>
                  <Switch
                    id="rec-following"
                    checked={prefs.useFollowingSignals}
                    disabled={isSaving}
                    onCheckedChange={() => toggle('useFollowingSignals')}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/60">
                  <div>
                    <Label htmlFor="rec-interests">Interesses e temas</Label>
                    <p className="text-xs text-muted-foreground">Hashtags e assuntos da bio/posts.</p>
                  </div>
                  <Switch
                    id="rec-interests"
                    checked={prefs.useInterestSignals}
                    disabled={isSaving}
                    onCheckedChange={() => toggle('useInterestSignals')}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/60">
                  <div>
                    <Label htmlFor="rec-activity">Atividade recente</Label>
                    <p className="text-xs text-muted-foreground">Priorizar contas ativas recentemente.</p>
                  </div>
                  <Switch
                    id="rec-activity"
                    checked={prefs.useActivitySignals}
                    disabled={isSaving}
                    onCheckedChange={() => toggle('useActivitySignals')}
                  />
                </div>
              </div>

              {/* Quem sugerir */}
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Quem sugerir
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'all', label: 'Todas' },
                    { value: 'local', label: 'Só local' },
                    { value: 'fediverse', label: 'Fediverso' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isSaving}
                      onClick={() => void applyUpdate({ ...prefs, networkScope: opt.value }, true)}
                      className={cn(
                        'rounded-md border px-2.5 py-2 text-xs font-medium transition-colors',
                        prefs.networkScope === opt.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Estilo do algoritmo */}
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Estilo do algoritmo
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'balanced', label: 'Equilibrado' },
                    { value: 'similar', label: 'Mais parecidos' },
                    { value: 'discovery', label: 'Descoberta' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isSaving}
                      onClick={() => void applyUpdate({ ...prefs, mode: opt.value }, true)}
                      className={cn(
                        'rounded-md border px-2.5 py-2 text-xs font-medium transition-colors',
                        prefs.mode === opt.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Privacidade do próprio usuário */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="rec-optout" className="font-semibold">Não me sugerir para outros</Label>
              <p className="text-xs text-muted-foreground">Seu perfil não aparecerá em listas de sugestões.</p>
            </div>
            <Switch
              id="rec-optout"
              checked={Boolean(prefs.optOutFromSuggestions)}
              disabled={isSaving}
              onCheckedChange={() => toggle('optOutFromSuggestions')}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSaving}
              onClick={() => void applyUpdate({ ...DEFAULT_RECOMMENDATION_PREFERENCES })}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Restaurar padrão
            </Button>
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
              Concluir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
