// src/components/settings/ConfirmacaoDeLeituraSwitch.tsx
'use client';

import React from 'react';
import { CheckCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useHiperChatPreferences } from '@/hooks/useHiperChatPreferences';

/**
 * A escolha da confirmação de leitura, UMA vez, usada pelo HiperVerso e pelo HiperChat.
 *
 * Existe como componente compartilhado por um motivo prático: enquanto o botão vivia só nas configurações do
 * HiperChat, no HiperVerso a confirmação sairia sem ninguém ter escolhido nada. E porque o texto importa — o acordo
 * aqui é de mão dupla (quem desliga não envia a sua E não vê a dos outros), e duas telas com redações diferentes
 * viram duas promessas diferentes.
 *
 * A escolha é deste APARELHO (localStorage por conta), nunca vai para o servidor, e quem a respeita de verdade é
 * `src/lib/messages/recibos.ts`: sem ela ligada, a tela da conversa não escreve a marca nem abre o ouvinte dela.
 */
export default function ConfirmacaoDeLeituraSwitch({ userId }: { userId?: string | null }) {
  const { preferencias, salvar } = useHiperChatPreferences(userId);

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <CheckCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">Confirmação de leitura</p>
          <p className="text-xs text-muted-foreground">
            Avisar que você leu — e ver quando leram você. Desligando, as duas coisas somem: você deixa de enviar e
            deixa de ver. Os ✓ de enviada e entregue continuam.
          </p>
        </div>
      </div>
      <Switch
        checked={preferencias.confirmacaoDeLeitura}
        onCheckedChange={(v) => salvar({ confirmacaoDeLeitura: v })}
        aria-label="Confirmação de leitura"
      />
    </div>
  );
}
