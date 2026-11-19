// src/components/profile/FollowRequestDialog.tsx
// "Pedir para seguir" um perfil FECHADO do Fediverso. Ação primeiro: dois botões diretos ("Pedir com mensagem" e "Só pedir") e a mensagem
// já escrita, que a pessoa pode editar. A explicação fica no balão "?" (nada de parede de texto). Só abre por clique individual.
'use client';

import React, { useEffect, useState } from 'react';
import { HelpCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

/** Mesmo limite de FOLLOW_NOTE_MAX em lib/activitypub/outboundFollow.ts (que não pode ir ao navegador: usa node:crypto). */
const NOTE_MAX = 450;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `usuario@dominio` do perfil (sem o @ da frente). */
  handle: string;
  /** Quem pede, já no formato `@usuario@exercitodolula.app`. */
  me: string;
  busy: boolean;
  /** `null` = só o pedido, sem mensagem. */
  onSend: (note: string | null) => void;
};

export default function FollowRequestDialog({ open, onOpenChange, handle, me, busy, onSend }: Props) {
  const t = useTranslations('RemoteFollow');
  const [text, setText] = useState('');

  // Cada vez que abre, volta à mensagem sugerida (apresentando quem pede).
  useEffect(() => {
    if (open) setText(t('suggestedMessage', { me }));
  }, [open, me, t]);

  return (
    <Dialog open={open} onOpenChange={(valor) => (busy ? undefined : onOpenChange(valor))}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()} data-testid="follow-request-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-base">
            <span className="min-w-0 truncate">{t('dialogTitle', { handle: `@${handle}` })}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t('helpLabel')}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <HelpCircle className="h-4 w-4" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-sm">{t('help')}</PopoverContent>
            </Popover>
          </DialogTitle>
          <DialogDescription className="sr-only">{t('help')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <label htmlFor="follow-request-message" className="sr-only">
            {t('messageLabel', { handle: `@${handle}` })}
          </label>
          <Textarea
            id="follow-request-message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_MAX}
            rows={4}
            disabled={busy}
            className="resize-none text-sm"
          />
          <p className="text-right text-xs text-muted-foreground" aria-hidden="true">
            {Array.from(text).length}/{NOTE_MAX}
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={() => onSend(text.trim())} disabled={busy || text.trim().length === 0} data-testid="follow-request-with-note">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('sendWithMessage')}
          </Button>
          <Button variant="outline" onClick={() => onSend(null)} disabled={busy} data-testid="follow-request-silent">
            {t('sendSilent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
