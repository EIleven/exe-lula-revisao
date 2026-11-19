// src/components/search/ResultadoDeComentario.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { MessageSquareQuote } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ResultadoDaBusca } from '@/app/api/search/route';

/**
 * Um comentário encontrado na busca, em cartão próprio.
 *
 * Antes, comentário ia junto dos posts para a lista do feed e saía torto: o cartão do feed espera um post, e a
 * contagem da aba passava a não bater com o que aparecia na tela. Aqui o comentário é o que ele é — um trecho de
 * conversa — e o cartão leva direto para o post onde ele foi dito, que é o que a pessoa quer quando acha um.
 *
 * O destaque dos termos vem como PARES DE ÍNDICES do servidor, nunca como HTML montado: assim não existe caminho em
 * que texto escrito por outra pessoa vire marcação dentro desta página.
 */
export default function ResultadoDeComentario({
  resultado,
  locale,
}: {
  resultado: ResultadoDaBusca;
  locale: string;
}) {
  const href = resultado.postPaiId ? `/${locale}/post/${resultado.postPaiId}` : `/${locale}`;
  const inicial = (resultado.autorNome || resultado.autorHandle || '?').charAt(0).toUpperCase();

  /** Quebra o trecho nos pedaços marcados. Só <mark>, montado aqui — o texto entra como texto. */
  const pedacos: React.ReactNode[] = [];
  let cursor = 0;
  for (const [de, ate] of resultado.marcas) {
    if (de < cursor || ate > resultado.trecho.length) continue;
    if (de > cursor) pedacos.push(resultado.trecho.slice(cursor, de));
    pedacos.push(
      <mark key={`${de}-${ate}`} className="rounded bg-primary/20 px-0.5 text-foreground">
        {resultado.trecho.slice(de, ate)}
      </mark>,
    );
    cursor = ate;
  }
  if (cursor < resultado.trecho.length) pedacos.push(resultado.trecho.slice(cursor));

  return (
    <Link
      href={href}
      className="block rounded-xl border border-border/70 p-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      <div className="flex items-start gap-2.5">
        <Avatar className="h-8 w-8 shrink-0">
          {resultado.autorAvatar && <AvatarImage src={resultado.autorAvatar} alt={resultado.autorNome || ''} />}
          <AvatarFallback className="text-[11px]">{inicial}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
            <span className="truncate font-semibold text-foreground">{resultado.autorNome || 'Alguém'}</span>
            {resultado.autorHandle && (
              <span className="truncate text-muted-foreground">@{resultado.autorHandle}</span>
            )}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MessageSquareQuote className="h-3 w-3" />
              comentário
            </span>
          </div>

          <p className="text-sm leading-snug text-foreground/90">{pedacos}</p>

          <p className="text-[11px] text-muted-foreground">Ver no post original</p>
        </div>
      </div>
    </Link>
  );
}
