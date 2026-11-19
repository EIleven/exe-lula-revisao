/**
 * Pode anexar este arquivo nesta conversa? A resposta antes de a pessoa esperar.
 *
 * Por que isto existe: o caminho do anexo tem dois destinos e um deles é invisível para quem escolhe o arquivo.
 * Arquivo comum sobe pela rota do servidor, que recusa a partir de `LIMITE_POR_ARQUIVO`. Vídeo sobe por um
 * caminho próprio, com transcodificação, e por isso pode ser grande. Só que numa conversa cifrada o vídeo é
 * cifrado ANTES de subir e vira um bloco `application/octet-stream`: deixa de parecer vídeo, perde o caminho
 * próprio e cai no teto da rota comum. O resultado, até aqui, era a pessoa escolher um vídeo de 30 segundos,
 * esperar a cifragem e receber "não foi possível concluir o envio" — sem nunca saber por quê.
 *
 * Hoje isso tem saída: acima do teto da rota comum, a conversa protegida usa o caminho em PEDAÇOS (`caminho:
 * 'protegido-grande'`), que cifra de 8 MB em 8 MB e sobe num objeto opaco próprio, até 200 MB. O que este módulo
 * decide é POR ONDE o arquivo vai — e o que ainda não cabe em lugar nenhum, recusa com o motivo dito.
 *
 * Então a decisão é tomada aqui, na hora de escolher o arquivo, com o texto que explica o motivo. Módulo puro,
 * sem importar nada: a suíte prova cada recusa sem navegador.
 */

/** Teto da rota comum de upload (igual a MAX_MEDIA_FILE_SIZE em lib/media/uploadPolicy.ts). */
export const LIMITE_POR_ARQUIVO = 5 * 1024 * 1024;

/**
 * O que a cifragem acrescenta ao tamanho: 16 bytes da etiqueta AES-GCM, mais folga para o envelope.
 * Entra na conta para o arquivo não passar aqui e ser recusado pelo servidor logo depois.
 */
export const SOBRECARGA_DA_CIFRAGEM = 1024;

const EXTENSAO_DE_VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|ogv)$/i;

export type ArquivoParaAvaliar = { name?: string | null; size?: number | null; type?: string | null };

/** Por onde o arquivo sobe. `protegido-grande` = cifragem em pedacos (src/lib/services/encryptedMediaService.ts). */
export type CaminhoDeEnvio = 'comum' | 'protegido-grande';

export type Veredito =
  | { ok: true; ehVideo: boolean; caminho: CaminhoDeEnvio }
  | { ok: false; motivo: 'vazio' | 'cifrado-grande' | 'grande'; titulo: string; mensagem: string };

/** Teto do anexo em conversa protegida (igual a LIMITE_MIDIA_PROTEGIDA em lib/crypto/e2eeMediaChunks.ts). */
export const LIMITE_PROTEGIDO = 200 * 1024 * 1024;

export function pareceVideo(arquivo: ArquivoParaAvaliar): boolean {
  const tipo = typeof arquivo?.type === 'string' ? arquivo.type : '';
  const nome = typeof arquivo?.name === 'string' ? arquivo.name : '';
  return tipo.startsWith('video/') || EXTENSAO_DE_VIDEO.test(nome);
}

/** "4,2 MB" — número curto, vírgula decimal, como se escreve em português. */
export function formatarTamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  const arredondado = mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb);
  return `${String(arredondado).replace('.', ',')} MB`;
}

/**
 * `cifrada` = esta conversa envia tudo cifrado ponta a ponta. Nesse caso o teto vale para todo mundo,
 * inclusive vídeo, porque o bloco cifrado sobe pela rota comum.
 */
export function avaliarAnexo(arquivo: ArquivoParaAvaliar, contexto: { cifrada: boolean }): Veredito {
  const tamanho = typeof arquivo?.size === 'number' && Number.isFinite(arquivo.size) ? arquivo.size : 0;
  const ehVideo = pareceVideo(arquivo);
  const teto = formatarTamanho(LIMITE_POR_ARQUIVO);

  if (tamanho <= 0) {
    return {
      ok: false,
      motivo: 'vazio',
      titulo: 'Arquivo vazio',
      mensagem: 'Esse arquivo está vazio ou não pôde ser lido. Escolha outro.',
    };
  }

  if (contexto.cifrada) {
    // Acima do teto da rota comum o arquivo vai pelo caminho em PEDAÇOS: cifra de 8 MB em 8 MB, sobe num objeto
    // opaco próprio e abre no aparelho. Antes isso era recusado, e a recusa era a única coisa honesta a fazer —
    // o bloco cifrado perdia o caminho de vídeo e morria no teto de 5 MB da rota comum.
    if (tamanho > LIMITE_PROTEGIDO) {
      return {
        ok: false,
        motivo: 'cifrado-grande',
        titulo: ehVideo ? 'Vídeo grande demais' : 'Arquivo grande demais',
        mensagem: `Nesta conversa tudo vai protegido, e o limite é ${formatarTamanho(LIMITE_PROTEGIDO)}. Este ${
          ehVideo ? 'vídeo' : 'arquivo'
        } tem ${formatarTamanho(tamanho)}.`,
      };
    }
    if (tamanho + SOBRECARGA_DA_CIFRAGEM >= LIMITE_POR_ARQUIVO) {
      return { ok: true, ehVideo, caminho: 'protegido-grande' };
    }
    return { ok: true, ehVideo, caminho: 'comum' };
  }

  // Conversa sem cifragem: vídeo tem caminho próprio e pode passar do teto da rota comum.
  if (ehVideo) return { ok: true, ehVideo, caminho: 'comum' };

  if (tamanho >= LIMITE_POR_ARQUIVO) {
    return {
      ok: false,
      motivo: 'grande',
      titulo: 'Arquivo grande demais',
      mensagem: `O limite é ${teto}. Este arquivo tem ${formatarTamanho(tamanho)}.`,
    };
  }

  return { ok: true, ehVideo, caminho: 'comum' };
}
