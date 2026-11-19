// src/lib/server/clientCredential.ts
// Emite credencial de login para o SDK cliente do Firebase Auth.
//
//  1) createCustomToken: o caminho CERTO. Exige que a conta de serviço do App Hosting possa assinar por ela mesma
//     (`roles/iam.serviceAccountTokenCreator` sobre ela mesma; concedido em 2026-11-15). Sem isso o Google nega
//     `iam.serviceAccounts.signBlob` e TODO login externo (Fediverso, Atmosfera, dispositivo) falha.
//  2) generateSignInWithEmailLink (Identity Toolkit, não usa signBlob): só funciona com o login "por link de e-mail" ATIVO no
//     Auth, e hoje ele está desligado. Fica como rede de proteção, não como plano.
//
// NÃO existe um terceiro degrau que grave senha na conta. A "senha de uso único" não era de uso único: continuava valendo
// depois do login, a conta passava a ter provedor de senha (e o login seguinte, que só tenta a senha em conta SEM provedor de
// senha, falhava de novo) e uma credencial nova ficava na conta de quem só quis entrar.
//
// Nunca importar em código do navegador.
import { adminAuth } from '@/lib/server/firebaseAdmin';

export interface ClientAuthCredential {
  customToken?: string;
  emailLink?: string;
  email?: string;
}

const DEFAULT_CONTINUE_URL = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://hiperverso.app'}/pt-BR/login`;

const textoDe = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

export async function mintClientAuthCredential(uid: string, claims?: Record<string, unknown>): Promise<ClientAuthCredential> {
  const auth = adminAuth();
  try {
    return { customToken: await auth.createCustomToken(uid, claims) };
  } catch (erroToken) {
    console.warn('[clientCredential] createCustomToken indisponível, tentando o link por e-mail:', textoDe(erroToken));
    try {
      const user = await auth.getUser(uid);
      let email = user.email?.trim() || '';
      if (!email) {
        email = `${uid}@auth.exercitodolula.app`;
        await auth.updateUser(uid, { email, emailVerified: true });
      }
      const emailLink = await auth.generateSignInWithEmailLink(email, { url: DEFAULT_CONTINUE_URL, handleCodeInApp: true });
      return { emailLink, email };
    } catch (erroLink) {
      // O texto completo fica só no log do servidor; quem chama o transforma em um código para a URL (loginErrors.ts).
      console.error('[clientCredential] nenhuma credencial pôde ser emitida:', `token: ${textoDe(erroToken)} | link: ${textoDe(erroLink)}`);
      throw new Error(`credential_unavailable: ${textoDe(erroLink)}`);
    }
  }
}
