// src/components/messages/AnexoProtegidoGrande.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Download, Loader2, Lock, Play, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import PlatformVideo from '@/components/shared/PlatformVideo';
import { abrirCapaProtegida, abrirMidiaProtegida } from '@/lib/services/encryptedMediaService';
import { formatarTamanho } from '@/lib/messages/anexoPolitica';
import { lerDescritorV2 } from '@/lib/crypto/e2eeMediaChunks';

/**
 * Anexo grande de conversa protegida (Etapa 1: baixa inteiro, confere, depois toca).
 *
 * A diferença que justifica um componente próprio é UMA decisão: **nada é baixado sozinho.** Um balão de vídeo pode
 * ter 200 MB; baixar porque ele apareceu na rolagem queimaria a internet de quem usa — e numa rede onde boa parte
 * das pessoas está no celular, com dado contado, isso não é detalhe. Então mostra-se a capa (uns 30 KB) e o tamanho,
 * e quem decide baixar é a pessoa.
 *
 * A capa é cifrada com a mesma chave do vídeo e feita no aparelho de quem enviou: o servidor não poderia gerá-la,
 * porque ele não enxerga o vídeo.
 */
export default function AnexoProtegidoGrande({
  fileUrl,
  posterUrl,
  descritor,
}: {
  fileUrl: string;
  posterUrl?: string | null;
  /** O descritor já aberto (v2), vindo da mensagem cifrada. */
  descritor: unknown;
}) {
  const d = lerDescritorV2(descritor);
  const [capa, setCapa] = useState<string | null>(null);
  const [midia, setMidia] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [erro, setErro] = useState<'rede' | 'adulterado' | 'descritor' | null>(null);

  // A capa é pequena: essa sim pode vir sozinha.
  useEffect(() => {
    if (!posterUrl || !d) return;
    let cancelado = false;
    let urlCriada: string | null = null;
    void abrirCapaProtegida(posterUrl, descritor).then((url) => {
      if (cancelado) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      urlCriada = url;
      setCapa(url);
    });
    return () => {
      cancelado = true;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [posterUrl, descritor, d]);

  // O arquivo aberto vira um endereço temporário no navegador; solta-se ao sair da tela.
  useEffect(() => () => { if (midia) URL.revokeObjectURL(midia); }, [midia]);

  if (!d) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
        <Lock className="h-4 w-4 shrink-0" />
        <span>Não foi possível abrir a chave deste arquivo neste aparelho.</span>
      </div>
    );
  }

  const ehVideo = d.mime.startsWith('video/');
  const baixando = progresso !== null;

  const baixar = async () => {
    setErro(null);
    setProgresso(0);
    const r = await abrirMidiaProtegida(fileUrl, descritor, setProgresso);
    setProgresso(null);
    if (r.ok) setMidia(r.objectUrl);
    else setErro(r.motivo);
  };

  if (midia) {
    if (ehVideo) {
      return (
        <div className="mt-2 max-w-[260px] overflow-hidden rounded-lg bg-black/90 sm:max-w-[300px]" data-interactive="true">
          <PlatformVideo controls src={midia} className="max-h-[260px] w-full rounded-lg object-contain" preload="metadata" />
        </div>
      );
    }
    if (d.mime.startsWith('image/')) {
      return (
        <div className="mt-2 max-w-[260px] sm:max-w-[300px]" data-interactive="true">
          <img src={midia} alt={d.name || 'Anexo protegido'} className="max-h-[260px] w-full rounded-lg object-contain" />
        </div>
      );
    }
    return (
      <div className="mt-2" data-interactive="true">
        <Button asChild size="sm" variant="secondary" className="h-8 rounded-full text-xs">
          <a href={midia} download={d.name || 'anexo'}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Salvar {d.name || 'arquivo'}
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 w-[260px] max-w-full overflow-hidden rounded-lg border border-border/60 bg-black/20 sm:w-[300px]" data-interactive="true">
      <div className="relative flex h-[150px] items-center justify-center bg-black/40">
        {capa ? (
          <img src={capa} alt="" className="h-full w-full object-cover" />
        ) : (
          <Lock className="h-7 w-7 text-muted-foreground/70" />
        )}
        {!baixando && (
          <button
            type="button"
            onClick={baixar}
            aria-label={ehVideo ? 'Baixar e tocar o vídeo' : 'Baixar o arquivo'}
            className="absolute inset-0 flex items-center justify-center transition-colors hover:bg-black/25"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background/90 shadow-lg">
              {ehVideo ? <Play className="ml-0.5 h-5 w-5" /> : <Download className="h-5 w-5" />}
            </span>
          </button>
        )}
        {baixando && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </span>
        )}
      </div>

      <div className="space-y-1.5 p-2.5">
        {baixando ? (
          <>
            <Progress value={progresso ?? 0} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground">
              Baixando e abrindo… {Math.round(progresso ?? 0)}%
            </p>
          </>
        ) : erro ? (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {erro === 'rede'
              ? 'A conexão caiu no meio. Toque de novo para continuar.'
              : erro === 'adulterado'
                ? 'Este arquivo não confere com o que foi enviado — pode ter sido alterado ou chegou incompleto. Nada foi aberto.'
                : 'Não foi possível abrir a chave deste arquivo neste aparelho.'}
          </p>
        ) : (
          <p className="truncate text-[11px] text-muted-foreground">
            {d.name ? `${d.name} · ` : ''}
            {formatarTamanho(d.size)} · protegido
          </p>
        )}
      </div>
    </div>
  );
}
