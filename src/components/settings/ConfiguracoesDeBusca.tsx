// src/components/settings/ConfiguracoesDeBusca.tsx
'use client';

import React from 'react';
import { Clock, Globe, Languages, ShieldAlert, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { usePreferenciasDeBusca } from '@/hooks/usePreferenciasDeBusca';
import type { IdiomaDeBusca } from '@/lib/search/preferenciasDeBusca';
import { cn } from '@/lib/utils';

const IDIOMAS: Array<{ valor: IdiomaDeBusca; rotulo: string }> = [
  { valor: 'auto', rotulo: 'Como o app' },
  { valor: 'pt', rotulo: 'Português' },
  { valor: 'en', rotulo: 'Inglês' },
  { valor: 'es', rotulo: 'Espanhol' },
  { valor: 'todos', rotulo: 'Todos' },
];

function Linha({
  Icone,
  titulo,
  descricao,
  children,
}: {
  Icone: typeof Globe;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/70 p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * As escolhas de busca desta pessoa, neste aparelho.
 *
 * Tudo aqui fica no aparelho e nada vai para o servidor — em especial o histórico. "O que essa pessoa procurou" diz
 * mais do que o que ela publicou, e numa rede política isso é material que não deveria existir em servidor nenhum,
 * nem no nosso. Por isso a limpeza é um toque, e desligar o histórico apaga o que já existia na mesma hora.
 */
export default function ConfiguracoesDeBusca({ userId }: { userId?: string | null }) {
  const { preferencias, historico, salvar, limpar, esquecer } = usePreferenciasDeBusca(userId);

  return (
    <div className="space-y-2">
      <Linha
        Icone={Globe}
        titulo="Resultados da Web"
        descricao="Mostrar a aba Web, com páginas do índice próprio do HiperVerso. Nada de buscador de terceiro."
      >
        <Switch
          checked={preferencias.resultadosWeb}
          onCheckedChange={(v) => salvar({ resultadosWeb: v })}
          aria-label="Resultados da Web na busca"
        />
      </Linha>

      <Linha
        Icone={ShieldAlert}
        titulo="Filtrar conteúdo sensível"
        descricao="Esconder da busca o que foi marcado como sensível. Vale só para a busca."
      >
        <Switch
          checked={preferencias.filtrarSensivel}
          onCheckedChange={(v) => salvar({ filtrarSensivel: v })}
          aria-label="Filtrar conteúdo sensível na busca"
        />
      </Linha>

      <div className="rounded-xl border border-border/70 p-3">
        <div className="flex items-start gap-2.5">
          <Languages className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Idioma preferido</Label>
              <p className="text-xs text-muted-foreground">
                Qual idioma vem primeiro nos resultados. &quot;Todos&quot; não filtra nada.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {IDIOMAS.map(({ valor, rotulo }) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => salvar({ idioma: valor })}
                  aria-pressed={preferencias.idioma === valor}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    preferencias.idioma === valor
                      ? 'border-primary bg-primary/15 font-medium text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Linha
        Icone={Clock}
        titulo="Guardar buscas recentes"
        descricao="Fica só neste aparelho, nunca no servidor. Desligando, o que já existe é apagado na hora."
      >
        <Switch
          checked={preferencias.guardarHistorico}
          onCheckedChange={(v) => salvar({ guardarHistorico: v })}
          aria-label="Guardar buscas recentes"
        />
      </Linha>

      {preferencias.guardarHistorico && historico.length > 0 && (
        <div className="rounded-xl border border-border/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Buscas recentes</p>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={limpar}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Limpar tudo
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {historico.map((consulta) => (
              <span
                key={consulta}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-xs"
              >
                <span className="truncate">{consulta}</span>
                <button
                  type="button"
                  onClick={() => esquecer(consulta)}
                  aria-label={`Esquecer a busca ${consulta}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
