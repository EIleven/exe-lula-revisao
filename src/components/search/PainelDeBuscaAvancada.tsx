// src/components/search/PainelDeBuscaAvancada.tsx
'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  BUSCA_VAZIA,
  COM,
  ORDENACOES,
  PERIODOS,
  TIPOS,
  escrever,
  interpretar,
  temFiltro,
  type BuscaAvancada,
  type ComFiltro,
  type Ordenacao,
  type Periodo,
  type TipoDeConteudo,
} from '@/lib/search/operadores';

/**
 * O painel de Busca Avançada.
 *
 * A regra que organiza este componente: o painel e a BARRA são a mesma coisa escrita de dois jeitos. Mexer aqui
 * reescreve a barra (`escrever`), e digitar na barra marca os controles daqui (`interpretar`). Se os dois pudessem
 * divergir, a pessoa marcaria um filtro, veria outra coisa na barra, e nenhum dos dois mereceria confiança. A ida e
 * volta é provada em e2e/busca-operadores-check.mjs.
 *
 * Quem não quiser saber de operador nenhum continua só digitando: tudo aqui é opcional e começa fechado.
 */

const ROTULO_PERIODO: Record<Periodo, string> = {
  '24h': '24 horas',
  '7d': '7 dias',
  '30d': '30 dias',
  tudo: 'Qualquer data',
};

const ROTULO_TIPO: Record<TipoDeConteudo, string> = {
  post: 'Publicações',
  artigo: 'Artigos',
  comentario: 'Comentários',
  pessoa: 'Pessoas',
  web: 'Web',
};

const ROTULO_COM: Record<ComFiltro, string> = {
  midia: 'Com mídia',
  fonte: 'Com fonte citada',
};

const ROTULO_ORDEM: Record<Ordenacao, string> = {
  relevancia: 'Relevância',
  recentes: 'Mais recentes',
  curtidos: 'Mais curtidos',
};

/** Um botão que liga/desliga um valor dentro de uma lista. Usado para tipo e para "com". */
function Alternador<T extends string>({
  valores,
  ativos,
  rotulos,
  aoAlternar,
}: {
  valores: readonly T[];
  ativos: readonly T[];
  rotulos: Record<T, string>;
  aoAlternar: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {valores.map((v) => {
        const ligado = ativos.includes(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => aoAlternar(v)}
            aria-pressed={ligado}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              ligado
                ? 'border-primary bg-primary/15 font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {rotulos[v]}
          </button>
        );
      })}
    </div>
  );
}

export default function PainelDeBuscaAvancada({
  consulta,
  aoMudar,
}: {
  /** A barra de busca inteira, com operadores e tudo. */
  consulta: string;
  /** Devolve a barra reescrita. Quem controla o endereço da página é quem chama. */
  aoMudar: (novaConsulta: string) => void;
}) {
  const busca = useMemo(() => interpretar(consulta), [consulta]);
  const [aberto, setAberto] = useState(false);
  const ativo = temFiltro(busca);

  const aplicar = (mudanca: Partial<BuscaAvancada>) => {
    aoMudar(escrever({ ...busca, ...mudanca }));
  };
  const alternarEm = <K extends 'tipos' | 'com'>(campo: K, valor: BuscaAvancada[K][number]) => {
    const atual = busca[campo] as readonly string[];
    const novo = atual.includes(valor) ? atual.filter((x) => x !== valor) : [...atual, valor];
    aplicar({ [campo]: novo } as Partial<BuscaAvancada>);
  };

  return (
    <div className="mb-4 rounded-xl border border-border/70 bg-card/40">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm"
      >
        <span className="flex items-center gap-2 font-medium">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Busca avançada
          {ativo && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              filtros ativos
            </Badge>
          )}
        </span>
        {aberto ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-border/60 px-3 py-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="busca-de" className="text-xs">De (@usuário)</Label>
              <Input
                id="busca-de"
                value={busca.de.join(' ')}
                onChange={(e) => aplicar({ de: e.target.value.split(/\s+/).map((x) => x.replace(/^@/, '').trim()).filter(Boolean) })}
                placeholder="breno"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="busca-instancia" className="text-xs">Instância do Fediverso</Label>
              <Input
                id="busca-instancia"
                value={busca.instancias.join(' ')}
                onChange={(e) => aplicar({ instancias: e.target.value.split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean) })}
                placeholder="mastodon.social"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="busca-frase" className="text-xs">Frase exata</Label>
              <Input
                id="busca-frase"
                value={busca.frases.join(' | ')}
                onChange={(e) => aplicar({ frases: e.target.value.split('|').map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2) })}
                placeholder="reforma agrária"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="busca-excluir" className="text-xs">Excluir palavras</Label>
              <Input
                id="busca-excluir"
                value={busca.excluir.join(' ')}
                onChange={(e) => aplicar({ excluir: e.target.value.split(/\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2) })}
                placeholder="futebol novela"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de conteúdo</Label>
            <Alternador valores={TIPOS} ativos={busca.tipos} rotulos={ROTULO_TIPO} aoAlternar={(v) => alternarEm('tipos', v)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Contém</Label>
            <Alternador valores={COM} ativos={busca.com} rotulos={ROTULO_COM} aoAlternar={(v) => alternarEm('com', v)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Período</Label>
              <div className="flex flex-wrap gap-1.5">
                {PERIODOS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => aplicar({ periodo: p })}
                    aria-pressed={busca.periodo === p}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      busca.periodo === p
                        ? 'border-primary bg-primary/15 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {ROTULO_PERIODO[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ordenar por</Label>
              <div className="flex flex-wrap gap-1.5">
                {ORDENACOES.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => aplicar({ ordenacao: o })}
                    aria-pressed={busca.ordenacao === o}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      busca.ordenacao === o
                        ? 'border-primary bg-primary/15 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {ROTULO_ORDEM[o]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
            {/* A barra montada fica à vista: quem quiser aprender os operadores aprende olhando, e quem já sabe
                confere que o painel escreveu o que ele esperava. */}
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              {escrever(busca) || 'sem filtros'}
            </code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 text-xs"
              disabled={!ativo}
              onClick={() => aoMudar(escrever({ ...BUSCA_VAZIA, texto: busca.texto }))}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
