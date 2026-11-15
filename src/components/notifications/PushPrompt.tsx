// src/components/notifications/PushPrompt.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BellRing, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { enablePush, getPushPermission, isPushActive, isPushTurnedOff, type PushPermission } from '@/lib/services/pushNotificationService';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'exelula:push-prompt-dismissed';
const REASK_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // "Agora não" some por 14 dias

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < REASK_AFTER_MS;
  } catch {
    return false;
  }
}

/**
 * Convite para ligar as notificações do aparelho (navegador ou app). Só aparece quando falta ligar e a pessoa não desligou
 * de propósito; se o aparelho bloqueou, explica como liberar. Quem já recebe push ou não tem como receber não vê nada.
 */
export default function PushPrompt({ userId, className }: { userId: string; className?: string }) {
  const t = useTranslations('Push');
  const locale = useLocale();
  const { toast } = useToast();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [active, setActive] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([getPushPermission(), isPushActive(userId)]).then(([perm, isActive]) => {
      if (!alive) return;
      setPermission(perm);
      setActive(isActive);
      setHidden(dismissedRecently() || isPushTurnedOff(userId));
    });
    return () => { alive = false; };
  }, [userId]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      await enablePush(userId, locale);
      haptics.success();
      setActive(true);
      toast({ title: t('enabledTitle'), description: t('enabledBody') });
    } catch (error: unknown) {
      console.error('Erro ao ativar as notificações:', error);
      setPermission(await getPushPermission());
      toast({ title: t('errorTitle'), description: friendlyErrorMessage(error, t('errorBody')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [userId, locale, toast, t]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* sem localStorage: some até recarregar */ }
    setHidden(true);
  };

  if (permission === null || permission === 'unsupported' || active || hidden) return null;

  const blocked = permission === 'denied';
  return (
    <div className={cn('mx-4 mb-3 flex items-start gap-3 rounded-lg border bg-card p-4', className)} data-testid="push-prompt" role="region" aria-label={t('promptTitle')}>
      <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold text-foreground">{blocked ? t('blockedTitle') : t('promptTitle')}</p>
        <p className="text-sm text-muted-foreground">{blocked ? t('blockedBody') : t('promptBody')}</p>
        {!blocked && (
          <div className="flex gap-2 pt-2">
            <Button type="button" size="sm" onClick={enable} disabled={busy} data-testid="push-prompt-enable">{t('enable')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={dismiss}>{t('later')}</Button>
          </div>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label={t('close')} className="rounded-full p-1 text-muted-foreground hover:bg-muted [@media(pointer:coarse)]:p-2">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
