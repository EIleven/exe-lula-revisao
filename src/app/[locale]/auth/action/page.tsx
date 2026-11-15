// src/app/[locale]/auth/action/page.tsx
// Página que trata TODOS os links de ação do Firebase Authentication, no domínio oficial:
// confirmação de e-mail, redefinição de senha, reversão de troca de e-mail e conclusão de troca de e-mail.
//
// SEGURANÇA, o ponto principal: o parâmetro `continue` é dado hostil. Ele NUNCA é usado como endereço — passa por
// `resolveDestination`, que o compara contra uma lista fechada de caminhos internos e, se não casar exatamente, cai
// no login. Sem isso, qualquer pessoa mandaria o link legítimo do Firebase com `continue=https://site-falso/` e
// usaria a nossa marca como trampolim.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { siteConfig } from '@/config/site';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import {
  classifyActionError,
  destinationPath,
  normalizeLocale,
  parseActionMode,
  resolveActionDestination,
  type ActionFailure,
  type ActionMode,
} from '@/lib/auth/actionLinks';
import { checkPassword } from '@/lib/auth/password';
import { reconcilePrivateEmail } from '@/lib/services/userPrivate';
import { ensureMembershipToken } from '@/lib/services/membership';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'pedir-senha'; email: string | null }
  | { fase: 'sucesso'; modo: ActionMode }
  | { fase: 'erro'; falha: ActionFailure };

function codigoDe(erro: unknown): string | null {
  return typeof erro === 'object' && erro !== null && 'code' in erro
    ? String((erro as { code?: unknown }).code)
    : null;
}

function AuthActionInner() {
  const t = useTranslations('AuthAction');
  const locale = normalizeLocale(useLocale());
  const router = useRouter();
  const params = useSearchParams();

  const modo = parseActionMode(params.get('mode'));
  const oobCode = params.get('oobCode');
  const destino = resolveActionDestination(
    params.get('continue'),
    params.get('continueUrl'),
    siteConfig.officialOrigin,
  );
  const caminhoDoDestino = destinationPath(destino, locale);

  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);

  // Aplica o código uma vez, ao abrir.
  useEffect(() => {
    let cancelado = false;

    (async () => {
      if (!modo || !oobCode) {
        if (!cancelado) setEstado({ fase: 'erro', falha: 'invalido-ou-usado' });
        return;
      }

      try {
        if (modo === 'resetPassword') {
          // Só valida o código e descobre o e-mail; a troca acontece no formulário.
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (!cancelado) setEstado({ fase: 'pedir-senha', email });
          return;
        }

        await applyActionCode(auth, oobCode);

        // Depois de confirmar o e-mail (ou concluir a troca), o token em memória ainda diz `email_verified: false`.
        // As regras do Firestore e do Storage leem isso DO TOKEN, então sem renovar a pessoa veria "confirmado" na
        // tela e continuaria sendo barrada ao publicar.
        if (auth.currentUser) {
          await auth.currentUser.reload();
          await ensureMembershipToken(auth.currentUser);
          await auth.currentUser.getIdToken(true);
          await reconcilePrivateEmail();
        }

        if (!cancelado) setEstado({ fase: 'sucesso', modo });
      } catch (erro) {
        if (!cancelado) setEstado({ fase: 'erro', falha: classifyActionError(codigoDe(erro)) });
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [modo, oobCode]);

  const salvarSenha = async () => {
    if (!oobCode) return;
    setErroSenha(null);

    if (senha !== senha2) {
      setErroSenha(t('password.mismatch'));
      return;
    }
    const email = estado.fase === 'pedir-senha' ? estado.email ?? undefined : undefined;
    const check = checkPassword(senha, email);
    if (!check.ok) {
      setErroSenha(t(`password.problem.${check.problems[0]}`));
      return;
    }

    setSalvando(true);
    try {
      await confirmPasswordReset(auth, oobCode, senha);
      setEstado({ fase: 'sucesso', modo: 'resetPassword' });
    } catch (erro) {
      setEstado({ fase: 'erro', falha: classifyActionError(codigoDe(erro)) });
    } finally {
      setSalvando(false);
    }
  };

  /**
   * "Já confirmei": o caso de quem abriu o e-mail no celular e voltou ao computador. Nesta sessão o código já foi
   * consumido, então aplicá-lo de novo dá `invalid-action-code` — mas a conta PODE já estar confirmada. Em vez de
   * deixar a pessoa olhando uma mensagem de erro, releia a conta e diga a verdade.
   */
  const jaConfirmei = useCallback(async () => {
    setConferindo(true);
    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        if (auth.currentUser.emailVerified) {
          await auth.currentUser.getIdToken(true);
          setEstado({ fase: 'sucesso', modo: 'verifyEmail' });
          return;
        }
      }
      router.push(destinationPath('login', locale));
    } finally {
      setConferindo(false);
    }
  }, [router, locale]);

  const tituloSucesso: Record<ActionMode, string> = {
    verifyEmail: t('success.verifyEmail.title'),
    resetPassword: t('success.resetPassword.title'),
    recoverEmail: t('success.recoverEmail.title'),
    verifyAndChangeEmail: t('success.verifyAndChangeEmail.title'),
  };
  const corpoSucesso: Record<ActionMode, string> = {
    verifyEmail: t('success.verifyEmail.body'),
    resetPassword: t('success.resetPassword.body'),
    recoverEmail: t('success.recoverEmail.body'),
    verifyAndChangeEmail: t('success.verifyAndChangeEmail.body'),
  };

  return (
    <div className="container mx-auto flex max-w-md flex-col justify-center py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {estado.fase === 'carregando' && (
            <div className="space-y-3" aria-live="polite" aria-busy="true">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <p className="text-sm text-muted-foreground">{t('checking')}</p>
            </div>
          )}

          {estado.fase === 'sucesso' && (
            <div aria-live="polite">
              <Alert>
                <AlertTitle>{tituloSucesso[estado.modo]}</AlertTitle>
                <AlertDescription>{corpoSucesso[estado.modo]}</AlertDescription>
              </Alert>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button asChild className="flex-1">
                  <Link href={caminhoDoDestino}>{t('continue')}</Link>
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link href={destinationPath('home', locale)}>{t('goHome')}</Link>
                </Button>
              </div>
            </div>
          )}

          {estado.fase === 'pedir-senha' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {estado.email ? t('password.forEmail', { email: estado.email }) : t('password.intro')}
              </p>
              <div className="space-y-2">
                <Label htmlFor="nova-senha">{t('password.new')}</Label>
                <Input
                  id="nova-senha"
                  type="password"
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nova-senha-2">{t('password.repeat')}</Label>
                <Input
                  id="nova-senha-2"
                  type="password"
                  autoComplete="new-password"
                  value={senha2}
                  onChange={(e) => setSenha2(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('password.rule')}</p>
              {erroSenha && (
                <Alert variant="destructive" aria-live="assertive">
                  <AlertDescription>{erroSenha}</AlertDescription>
                </Alert>
              )}
              <Button onClick={salvarSenha} disabled={salvando || !senha || !senha2} className="w-full">
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('password.save')}
              </Button>
            </div>
          )}

          {estado.fase === 'erro' && (
            <div aria-live="assertive">
              <Alert variant="destructive">
                <AlertTitle>{t(`error.${estado.falha}.title`)}</AlertTitle>
                <AlertDescription>{t(`error.${estado.falha}.body`)}</AlertDescription>
              </Alert>
              <div className="mt-4 flex flex-col gap-2">
                {estado.falha === 'invalido-ou-usado' && (
                  <Button onClick={jaConfirmei} disabled={conferindo}>
                    {conferindo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('alreadyConfirmed')}
                  </Button>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild variant="outline" className="flex-1">
                    <Link href={destinationPath('login', locale)}>{t('goLogin')}</Link>
                  </Button>
                  <Button asChild variant="outline" className="flex-1">
                    <Link href={destinationPath('settings-account', locale)}>{t('goAccount')}</Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          <p className="pt-2 text-xs text-muted-foreground">{t('identityNote')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuthActionPage() {
  // `useSearchParams` exige limite de Suspense para a página poder ser pré-renderizada.
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-md py-12">
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <AuthActionInner />
    </Suspense>
  );
}
