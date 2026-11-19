'use client';

/**
 * Pede a digital (ou rosto, ou PIN do aparelho) e diz se foi confirmada.
 *
 * Dois caminhos, os mesmos que a tela de Chaves já usa:
 *  - no app Android, o plugin próprio `BiometricBridge`, que fala com o androidx.biometric;
 *  - no navegador, WebAuthn com a passkey deste aparelho.
 *
 * Aqui `userVerification` é 'required', e não 'preferred' como no cadastro: isto é uma TRAVA. Com 'preferred'
 * o navegador pode devolver sucesso sem ter pedido nada a ninguém — exatamente o que não serve numa tranca.
 */

export type ResultadoDaDigital =
  | { ok: true }
  | { ok: false; motivo: 'indisponivel' | 'recusado' | 'erro'; mensagem: string };

type PluginBiometrico = {
  isAvailable: () => Promise<{ available: boolean }>;
  authenticate: (opts?: { title?: string; subtitle?: string }) => Promise<{ authenticated: boolean }>;
};

export async function pedirDigital(opcoes: { titulo: string; subtitulo: string }): Promise<ResultadoDaDigital> {
  // 1. App Android: plugin próprio.
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BiometricBridge')) {
      const ponte = registerPlugin<PluginBiometrico>('BiometricBridge');
      const disponivel = await ponte.isAvailable();
      if (!disponivel?.available) {
        return {
          ok: false,
          motivo: 'indisponivel',
          mensagem: 'Este aparelho não tem digital, rosto ou PIN configurados no Android.',
        };
      }
      const resposta = await ponte.authenticate({ title: opcoes.titulo, subtitle: opcoes.subtitulo });
      return resposta?.authenticated
        ? { ok: true }
        : { ok: false, motivo: 'recusado', mensagem: 'Não foi confirmada.' };
    }
  } catch {
    // Sem o plugin: segue para o navegador.
  }

  // 2. Navegador: WebAuthn.
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials?.get) {
    return {
      ok: false,
      motivo: 'indisponivel',
      mensagem: 'Este navegador não sabe pedir digital.',
    };
  }

  try {
    const desafio = crypto.getRandomValues(new Uint8Array(32));
    const prova = await navigator.credentials.get({
      publicKey: {
        challenge: desafio,
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return prova ? { ok: true } : { ok: false, motivo: 'recusado', mensagem: 'Não foi confirmada.' };
  } catch (erro) {
    const nome = erro instanceof DOMException ? erro.name : '';
    if (nome === 'NotAllowedError') {
      return { ok: false, motivo: 'recusado', mensagem: 'Cancelada ou sem autorização. Toque de novo para tentar.' };
    }
    return { ok: false, motivo: 'erro', mensagem: 'Não deu para pedir a digital agora.' };
  }
}
