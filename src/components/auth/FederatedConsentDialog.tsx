'use client';

import React, { useState } from 'react';
import { HelpCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface FederatedConsentChoice {
  accepted: boolean;
  syncProfile: boolean;
  syncFollowing: boolean;
  syncPosts: boolean;
  transferMode: 'p2p_first' | 'direct';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: 'fediverse' | 'bluesky' | null;
  handleOrInstance: string;
  loading: boolean;
  onConfirm: (consent: FederatedConsentChoice) => void;
}

export function FederatedConsentDialog({
  open,
  onOpenChange,
  provider,
  handleOrInstance,
  loading,
  onConfirm,
}: Props) {
  const [syncProfile, setSyncProfile] = useState(true);
  const [syncFollowing, setSyncFollowing] = useState(true);
  const [syncPosts, setSyncPosts] = useState(true);
  const [p2pFirst, setP2pFirst] = useState(true);

  const providerLabel = provider === 'bluesky' ? 'Bluesky' : 'Fediverso / Mastodon';

  return (
    <Dialog open={open} onOpenChange={(v) => (loading ? undefined : onOpenChange(v))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
            <span>Entrar com {providerLabel}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Como funciona"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-xs leading-relaxed">
                O HiperVerso cria ou vincula sua conta unificada <strong>@voce@hiperverso.social</strong> mantendo sua origem conectada. Você escolhe abaixo o que deseja trazer agora e pode alterar ou ressincronizar depois.
              </PopoverContent>
            </Popover>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Conectando <strong>{handleOrInstance}</strong>. Escolha o que deseja trazer:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 text-sm">
          <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5 cursor-pointer hover:bg-muted/30">
            <Checkbox checked={syncProfile} onCheckedChange={(v) => setSyncProfile(v === true)} className="mt-0.5" />
            <span className="text-xs leading-snug">
              <strong>Perfil completo</strong> (nome, bio, foto e capa atualizados)
            </span>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5 cursor-pointer hover:bg-muted/30">
            <Checkbox checked={syncFollowing} onCheckedChange={(v) => setSyncFollowing(v === true)} className="mt-0.5" />
            <span className="text-xs leading-snug">
              <strong>Quem eu sigo</strong> (preencher meu feed automaticamente)
            </span>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5 cursor-pointer hover:bg-muted/30">
            <Checkbox checked={syncPosts} onCheckedChange={(v) => setSyncPosts(v === true)} className="mt-0.5" />
            <span className="text-xs leading-snug">
              <strong>Posts e mídias públicos</strong> (últimas publicações da conta)
            </span>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5 cursor-pointer hover:bg-muted/30">
            <Checkbox checked={p2pFirst} onCheckedChange={(v) => setP2pFirst(v === true)} className="mt-0.5" />
            <span className="text-xs leading-snug">
              <strong>Preferir modo P2P / direto</strong> (com fallback automático seguro se a instância bloquear)
            </span>
          </label>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            disabled={loading}
            onClick={() =>
              onConfirm({
                accepted: true,
                syncProfile,
                syncFollowing,
                syncPosts,
                transferMode: p2pFirst ? 'p2p_first' : 'direct',
              })
            }
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Concordar e Continuar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() =>
              onConfirm({
                accepted: true,
                syncProfile: true,
                syncFollowing: false,
                syncPosts: false,
                transferMode: 'direct',
              })
            }
          >
            Entrar só com perfil básico
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

