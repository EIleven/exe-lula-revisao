// src/components/settings/AccountSecuritySection.tsx
'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { MultiFactorResolver } from 'firebase/auth';
import { CheckCircle2, KeyRound, Loader2, MailWarning, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import TotpCodeDialog from '@/components/auth/TotpCodeDialog';
import {
  describeSecondFactorError,
  disableTotp,
  finishTotpEnrollment,
  getTotpResolver,
  isMultiFactorRequired,
  isTotpEnrolled,
  reauthenticate,
  refreshEmailVerified,
  requiresRecentLogin,
  resolveTotpSignIn,
  sendAccountVerificationEmail,
  signInMethodOf,
  startTotpEnrollment,
  type TotpEnrollment,
} from '@/lib/services/accountSecurity';

type PendingAction = 'enable' | 'disable';

/** E-mail verificado e verificação em duas etapas por app autenticador (Configurações → Privacidade e Segurança). */
export default function AccountSecuritySection() {
  const { firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const [emailVerified, setEmailVerified] = useState(!!firebaseUser?.emailVerified);
  const [totpOn, setTotpOn] = useState(isTotpEnrolled(firebaseUser));
  const [busy, setBusy] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [enrollError, setEnrollError] = useState<string | null>(null);
  // Confirmar identidade (o Firebase exige login recente para mudar o segundo fator).
  const [reauthFor, setReauthFor] = useState<PendingAction | null>(null);
  const [password, setPassword] = useState('');
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthResolver, setReauthResolver] = useState<{ resolver: MultiFactorResolver; action: PendingAction } | null>(null);

  useEffect(() => {
    setEmailVerified(!!firebaseUser?.emailVerified);
    setTotpOn(isTotpEnrolled(firebaseUser));
  }, [firebaseUser]);

  useEffect(() => {
    if (!enrollment) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(enrollment.otpauthUri, { margin: 1, width: 200 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [enrollment]);

  if (!firebaseUser) return null;
  const method = signInMethodOf(firebaseUser);

  const handleSendVerification = async () => {
    setBusy('send-verification');
    try {
      await sendAccountVerificationEmail();
      toast({ title: 'E-mail enviado', description: `Abra o link que enviamos para ${firebaseUser.email}.` });
    } catch (error) {
      toast({ title: 'Não foi possível enviar', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const handleCheckVerification = async () => {
    setBusy('check-verification');
    try {
      const verified = await refreshEmailVerified();
      setEmailVerified(verified);
      toast(verified
        ? { title: 'E-mail verificado' }
        : { title: 'Ainda não verificado', description: 'Abra o link do e-mail e tente de novo.' });
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (action: PendingAction) => {
    setBusy(action);
    try {
      if (action === 'enable') {
        setEnrollment(await startTotpEnrollment());
        setCode('');
        setEnrollError(null);
      } else {
        await disableTotp();
        setTotpOn(false);
        toast({ title: 'Verificação em duas etapas desativada' });
      }
    } catch (error) {
      if (requiresRecentLogin(error)) {
        setPassword('');
        setReauthError(null);
        setReauthFor(action);
      } else {
        toast({ title: 'Não foi possível concluir', description: describeSecondFactorError(error), variant: 'destructive' });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleReauth = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const action = reauthFor;
    if (!action) return;
    setBusy('reauth');
    setReauthError(null);
    try {
      await reauthenticate(password);
      setReauthFor(null);
      await runAction(action);
    } catch (error) {
      if (isMultiFactorRequired(error)) {
        setReauthFor(null);
        setReauthResolver({ resolver: getTotpResolver(error), action });
      } else {
        const code = (error as { code?: string }).code;
        setReauthError(code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'Senha incorreta.'
          : describeSecondFactorError(error));
      }
    } finally {
      setBusy(null);
    }
  };

  const handleReauthCode = async (totp: string) => {
    if (!reauthResolver) return;
    await resolveTotpSignIn(reauthResolver.resolver, totp);
    const action = reauthResolver.action;
    setReauthResolver(null);
    await runAction(action);
  };

  const handleFinishEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enrollment) return;
    setBusy('finish');
    setEnrollError(null);
    try {
      await finishTotpEnrollment(enrollment, code);
      setEnrollment(null);
      setTotpOn(true);
      toast({ title: 'Verificação em duas etapas ativada', description: 'Na próxima entrada, o app autenticador vai pedir o código.' });
    } catch (error) {
      setEnrollError(describeSecondFactorError(error));
    } finally {
      setBusy(null);
    }
  };

  const groupedKey = enrollment?.secretKey.replace(/(.{4})/g, '$1 ').trim();

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Segurança da conta</h3>

      <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <p className="flex items-center gap-2 text-base font-medium">
            {emailVerified ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <MailWarning className="h-4 w-4 text-amber-500" />}
            E-mail {emailVerified ? 'verificado' : 'não verificado'}
          </p>
          <p className="text-sm text-muted-foreground break-all">{firebaseUser.email}</p>
        </div>
        {!emailVerified && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleSendVerification} disabled={!!busy}>
              {busy === 'send-verification' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar e-mail de verificação
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCheckVerification} disabled={!!busy}>
              {busy === 'check-verification' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Já confirmei
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 text-base font-medium">
              <ShieldCheck className={totpOn ? 'h-4 w-4 text-green-600' : 'h-4 w-4 text-muted-foreground'} />
              Verificação em duas etapas {totpOn ? 'ativada' : 'desativada'}
            </p>
            <p className="text-sm text-muted-foreground">
              Além da senha (ou do Google), a entrada pede um código de 6 dígitos de um app autenticador, como Google
              Authenticator, Microsoft Authenticator ou Authy. Sem SMS.
            </p>
          </div>
          {totpOn ? (
            <Button variant="outline" size="sm" onClick={() => { if (window.confirm('Desativar a verificação em duas etapas? Sua conta fica protegida só pela senha.')) void runAction('disable'); }} disabled={!!busy}>
              {busy === 'disable' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desativar
            </Button>
          ) : (
            <Button size="sm" onClick={() => void runAction('enable')} disabled={!!busy || !emailVerified || !!enrollment}>
              {busy === 'enable' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ativar
            </Button>
          )}
        </div>
        {!totpOn && !emailVerified && (
          <p className="text-sm text-amber-600 dark:text-amber-400">Verifique o seu e-mail para poder ativar.</p>
        )}

        {enrollment && (
          <form onSubmit={handleFinishEnrollment} className="space-y-4 border-t pt-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>No app autenticador, escolha adicionar conta e leia o QR code (ou digite a chave).</li>
              <li>Digite abaixo o código de 6 dígitos que aparecer.</li>
            </ol>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR code para o app autenticador" width={200} height={200} className="rounded-md border bg-white p-1" />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center rounded-md border"><Loader2 className="h-6 w-6 animate-spin" /></div>
              )}
              <div className="w-full min-w-0 space-y-3">
                <div>
                  <p className="flex items-center gap-1 text-sm font-medium"><KeyRound className="h-4 w-4" /> Chave para digitar</p>
                  <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-sm">{groupedKey}</code>
                </div>
                <Button asChild variant="outline" size="sm" className="sm:hidden">
                  <a href={enrollment.otpauthUri}><Smartphone className="mr-2 h-4 w-4" /> Abrir no app autenticador</a>
                </Button>
                <div className="space-y-2">
                  <Label htmlFor="totp-enroll-code">Código de 6 dígitos</Label>
                  <Input
                    id="totp-enroll-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    placeholder="000000"
                    className="max-w-[12rem] text-center text-xl tracking-[0.3em]"
                    aria-invalid={!!enrollError}
                    aria-describedby={enrollError ? 'totp-enroll-error' : undefined}
                    disabled={busy === 'finish'}
                  />
                  {enrollError && <p id="totp-enroll-error" className="text-sm text-destructive">{enrollError}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" disabled={busy === 'finish' || code.replace(/\D/g, '').length !== 6}>
                    {busy === 'finish' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirmar e ativar
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEnrollment(null)} disabled={busy === 'finish'}>
                    Cancelar
                  </Button>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>

      <Dialog open={!!reauthFor} onOpenChange={(open) => { if (!open && busy !== 'reauth') setReauthFor(null); }}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleReauth}>
            <DialogHeader>
              <DialogTitle>Confirme que é você</DialogTitle>
              <DialogDescription>
                {method === 'password'
                  ? 'Por segurança, digite a sua senha para mudar a verificação em duas etapas.'
                  : 'Por segurança, entre de novo com o Google para mudar a verificação em duas etapas.'}
              </DialogDescription>
            </DialogHeader>
            {method === 'password' && (
              <div className="my-4 space-y-2">
                <Label htmlFor="reauth-password">Senha</Label>
                <Input
                  id="reauth-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  disabled={busy === 'reauth'}
                />
              </div>
            )}
            {reauthError && <p className="my-2 text-sm text-destructive">{reauthError}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setReauthFor(null)} disabled={busy === 'reauth'}>Cancelar</Button>
              <Button type="submit" disabled={busy === 'reauth' || (method === 'password' && !password)}>
                {busy === 'reauth' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {method === 'password' ? 'Confirmar' : 'Entrar com o Google'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TotpCodeDialog
        open={!!reauthResolver}
        onSubmit={handleReauthCode}
        onCancel={() => setReauthResolver(null)}
        description="Digite o código do app autenticador para confirmar que é você."
      />
    </div>
  );
}
