
'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  loginUser, loginWithGoogle, loadProfileAfterSignIn,
  isProfileCompletionPending, clearProfileCompletionPending,
} from '@/lib/services/authService';
import { getTotpResolver, isMultiFactorRequired, resolveTotpSignIn } from '@/lib/services/accountSecurity';
import TotpCodeDialog from '@/components/auth/TotpCodeDialog';
import ForgotPasswordDialog from '@/components/auth/ForgotPasswordDialog';
import { FederatedConsentDialog, type FederatedConsentChoice } from '@/components/auth/FederatedConsentDialog';
import {
  GithubAuthProvider,
  signInWithCustomToken,
  signInWithEmailLink,
  signInWithPopup,
  type MultiFactorResolver,
} from 'firebase/auth';
import Link from 'next/link';
import { LogIn, Eye, EyeOff, Loader2, Globe, Cloud, KeyRound, Smartphone, Github } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getDeviceFriendlyLabel, getOrCreateDeviceId } from '@/lib/p2p/p2pDevicePairing';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import CompleteProfileDialog from '@/components/auth/CompleteProfileDialog';
import type { User } from '@/lib/types';
import { useLocale, useTranslations } from 'next-intl';
import { DEFAULT_SIGNUP_LIMIT, isAppCheckRequired, isSignupClosed, signupClosedLimit } from '@/lib/services/signupLimit';
import { Checkbox } from "@/components/ui/checkbox";
import { auth } from '@/lib/firebase';
import { loginReasonMessage, loginReasonOfAuthError } from '@/lib/auth/loginErrors';

// GitHub só aparece se for LIGADO de propósito (NEXT_PUBLIC_GITHUB_LOGIN=true no apphosting.yaml) E o provedor estiver
// habilitado no Firebase Auth. Em 2026-11-15 só o Google estava habilitado: o botão do GitHub falhava SEMPRE com
// `auth/operation-not-allowed`. Ligar exige registrar um app OAuth no GitHub (mais uma chave de big tech), o que contraria a
// direção do projeto (login primário por Fediverso, Atmosfera e dispositivo conectado): fica desligado até haver decisão.
const GITHUB_LOGIN_ENABLED = process.env.NEXT_PUBLIC_GITHUB_LOGIN === 'true';

function LoginPageSkeleton() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          <Skeleton className="mx-auto mb-4 w-12 h-12 rounded-full" />
          <Skeleton className="h-7 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-center text-sm">
          <Skeleton className="h-4 w-48" />
        </CardFooter>
      </Card>
    </div>
  );
}

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg role="img" viewBox="0 0 24 24" {...props}>
        <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
        />
        <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
        />
        <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
        />
        <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
        />
    </svg>
);


// Depois de entrar, "?redirect=" só leva a páginas deste site. Antes aceitava qualquer endereço: um link
// ".../login?redirect=https://site-falso" mandava a pessoa, logo depois do login de verdade, para uma cópia que pedia a
// senha "de novo" (redirecionamento aberto). O próprio URL do navegador faz a conferência, porque ele normaliza truques
// como "//site", "/\site" e "/<tab>/site" do mesmo jeito que a navegação faria.
function safeRedirectPath(value: string | null, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

const BR_FEDIVERSE_INSTANCES = [
  { domain: 'ursal.zone', label: 'URSAL (ursal.zone)' },
  { domain: 'organica.social', label: 'Orgânica (organica.social)' },
  { domain: 'bolha.one', label: 'Bolha (bolha.one)' },
  { domain: 'alquimidia.social.br', label: 'Alquimidia (alquimidia.social.br)' },
  { domain: 'social.teia.bio.br', label: 'Teia (social.teia.bio.br)' },
  { domain: 'comuna.social.br', label: 'Comuna (comuna.social.br)' },
  { domain: 'mato.social', label: 'Mato (mato.social)' },
] as const;

const consumedTicketsInMemory = new Set<string>();

function wasTicketAlreadyConsumed(ticket: string): boolean {
  if (consumedTicketsInMemory.has(ticket)) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(`exelula_ticket_${ticket}`) === '1';
  } catch {
    return false;
  }
}

function markTicketConsumed(ticket: string): void {
  consumedTicketsInMemory.add(ticket);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`exelula_ticket_${ticket}`, '1');
  } catch {
    // ignore
  }
}

function LoginPageContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); 
  // Marcado por padrão: desmarcado, o Firebase guarda a sessão só NESTA aba (browserSessionPersistence), e o post ou
  // perfil aberto em outra aba (ou o app reaberto) aparecia como visitante. Desmarcar segue valendo para computador
  // compartilhado.
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [altMethod, setAltMethod] = useState<string>('');
  const [isCompletingProfile, setIsCompletingProfile] = useState(false);
  const [newUser, setNewUser] = useState<User | null>(null);
  // Conta com verificação em duas etapas: depois da senha (ou do Google), o código do app autenticador.
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [federatedMode, setFederatedMode] = useState<'fediverse' | 'bluesky' | null>(null);
  const [federatedHandle, setFederatedHandle] = useState('');
  const [isFederatedLoading, setIsFederatedLoading] = useState(false);
  const [deviceLoginOpen, setDeviceLoginOpen] = useState(false);
  const [deviceHandle, setDeviceHandle] = useState('');
  const [isDeviceStartLoading, setIsDeviceStartLoading] = useState(false);
  const [deviceChallenge, setDeviceChallenge] = useState<{
    challengeId: string;
    secretToken: string;
    verificationCode: string;
    expiresAt: number;
    account: {
      username: string;
      federatedHandle: string;
      name: string;
      avatarUrl: string;
    };
  } | null>(null);
  const locale = useLocale();
  const tSignup = useTranslations('Signup');

  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { refreshCurrentUser, currentUser } = useCurrentUser();
  const consumedTicketRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const handleSuccessfulLogin = async (userName: string) => {
    await refreshCurrentUser();
    toast({ title: 'Login bem-sucedido', description: `Bem-vindo(a), ${userName}!` });
    if (
      auth.currentUser &&
      auth.currentUser.email &&
      !auth.currentUser.email.endsWith('@federated.hiperverso.app') &&
      !auth.currentUser.emailVerified
    ) {
      router.replace(`/${locale}/auth/verify-email`);
      return;
    }
    router.replace(safeRedirectPath(searchParams.get('redirect'), `/${locale}/?welcome=1`));
  };

  useEffect(() => {
    const preselected = searchParams.get('federated');
    if (preselected === 'fediverse' || preselected === 'bluesky') {
      setFederatedMode(preselected);
      setAltMethod(preselected);
    }
    const preHandle = searchParams.get('handle');
    if (preHandle && preHandle.trim()) {
      setFederatedHandle(preHandle.trim());
    }
    const authError = searchParams.get('auth_error');
    const authReason = searchParams.get('reason');
    if (authError) {
      toast({
        title: 'Erro na autenticação externa',
        description:
          loginReasonMessage(authReason) ??
          loginReasonMessage(loginReasonOfAuthError(authError)) ??
          'Não foi possível concluir o login com a rede externa. Tente novamente.',
        variant: 'destructive',
      });
    }
    const ticket = searchParams.get('ticket');
    if (!ticket) return;

    const targetRedirect = safeRedirectPath(searchParams.get('redirect'), `/${locale}/?welcome=1`);

    if (consumedTicketRef.current === ticket || wasTicketAlreadyConsumed(ticket)) {
      if (auth.currentUser) {
        router.replace(targetRedirect);
      }
      return;
    }
    consumedTicketRef.current = ticket;
    markTicketConsumed(ticket);
    setIsFederatedLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/auth/ticket?ticket=${encodeURIComponent(ticket)}`);
        if (!res.ok) {
          if (auth.currentUser) {
            router.replace(targetRedirect);
            return;
          }
          throw new Error('Ticket inválido ou expirado.');
        }
        const data = (await res.json()) as {
          customToken?: string;
          emailLink?: string;
          email?: string;
          uid: string;
          isNewUser: boolean;
        };
        if (data.customToken) {
          await signInWithCustomToken(auth, data.customToken);
        } else if (data.emailLink && data.email) {
          await signInWithEmailLink(auth, data.email, data.emailLink);
        } else {
          throw new Error('Credencial de sessão ausente.');
        }
        const user = await loadProfileAfterSignIn(data.uid);
        await refreshCurrentUser();
        toast({
          title: data.isNewUser ? 'Conta conectada!' : 'Login bem-sucedido',
          description: `Bem-vindo(a), ${user.name}!`,
        });
        router.replace(targetRedirect);
      } catch (err: any) {
        if (auth.currentUser) {
          router.replace(targetRedirect);
          return;
        }
        if (!unmountedRef.current) {
          toast({
            title: 'Erro ao entrar',
            description: err?.message || 'Não foi possível concluir o login.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!unmountedRef.current) setIsFederatedLoading(false);
      }
    })();
  }, [searchParams, locale, router, refreshCurrentUser, toast]);

  useEffect(() => {
    if (!deviceChallenge) return;
    let cancelled = false;
    let credentialWarned = false;

    const pollOnce = async () => {
      try {
        const res = await fetch('/api/auth/device-login/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId: deviceChallenge.challengeId,
            secretToken: deviceChallenge.secretToken,
          }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';
          customToken?: string;
          emailLink?: string;
          email?: string;
          uid?: string;
          error?: string;
        };
        if (cancelled) return;

        // Aprovado no outro aparelho, mas o servidor não conseguiu emitir a sessão AGORA: ele guarda a aprovação e a próxima
        // consulta tenta de novo. Avisa uma vez, em vez de deixar a pessoa olhando uma tela parada.
        if (data.status === 'pending' && data.error === 'credential_unavailable') {
          if (!credentialWarned) {
            credentialWarned = true;
            toast({
              title: 'Acesso aprovado',
              description: 'O servidor ainda não conseguiu iniciar a sua sessão. Estamos tentando de novo.',
            });
          }
          return;
        }

        if (data.status === 'approved' && data.uid && (data.customToken || (data.emailLink && data.email))) {
          setDeviceChallenge(null);
          try {
            if (data.customToken) {
              await signInWithCustomToken(auth, data.customToken);
            } else if (data.emailLink && data.email) {
              await signInWithEmailLink(auth, data.email, data.emailLink);
            }
          } catch {
            // A credencial é de uso único: se o Firebase a recusou não adianta consultar de novo. Diz o que houve.
            toast({
              title: 'Não foi possível entrar',
              description: 'O outro aparelho aprovou, mas a sessão não pôde ser iniciada. Peça um novo código e tente de novo.',
              variant: 'destructive',
            });
            return;
          }
          const user = await loadProfileAfterSignIn(data.uid);
          if (cancelled) return;
          await refreshCurrentUser();
          toast({
            title: 'Acesso autorizado pelo seu dispositivo!',
            description: `Bem-vindo(a), ${user.name}!`,
          });
          router.push(safeRedirectPath(searchParams.get('redirect'), `/${locale}/`));
          return;
        }

        if (data.status === 'rejected') {
          setDeviceChallenge(null);
          toast({
            title: 'Acesso recusado',
            description: 'A solicitação foi recusada no dispositivo conectado.',
            variant: 'destructive',
          });
        } else if (data.status === 'expired' || data.status === 'consumed') {
          setDeviceChallenge(null);
          toast({
            title: 'Solicitação expirada',
            description: data.error || 'O tempo para aprovar expirou. Tente novamente.',
            variant: 'destructive',
          });
        }
      } catch {
        // Mantém polling até expirar ou ser cancelado
      }
    };

    const interval = setInterval(() => {
      void pollOnce();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deviceChallenge, locale, router, refreshCurrentUser, searchParams, toast]);

  const handleDeviceLoginStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceHandle.trim()) return;
    setIsDeviceStartLoading(true);
    try {
      const res = await fetch('/api/auth/device-login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: deviceHandle.trim(),
          requesterDeviceId: getOrCreateDeviceId(),
          requesterDeviceLabel: getDeviceFriendlyLabel(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        challengeId?: string;
        secretToken?: string;
        verificationCode?: string;
        expiresAt?: number;
        account?: {
          username: string;
          federatedHandle: string;
          name: string;
          avatarUrl: string;
        };
      };
      if (!res.ok || !data.challengeId || !data.secretToken || !data.verificationCode || !data.account) {
        throw new Error(data.error || 'Não foi possível iniciar o login por dispositivo.');
      }
      setDeviceChallenge({
        challengeId: data.challengeId,
        secretToken: data.secretToken,
        verificationCode: data.verificationCode,
        expiresAt: data.expiresAt || Date.now() + 5 * 60 * 1000,
        account: data.account,
      });
    } catch (err: any) {
      toast({
        title: 'Não foi possível solicitar acesso',
        description: err?.message || 'Verifique seu @ e tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsDeviceStartLoading(false);
    }
  };

  const handleGithubLogin = async () => {
    setIsGithubLoading(true);
    try {
      const provider = new GithubAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const user = await loadProfileAfterSignIn(cred.user.uid);
      if (isProfileCompletionPending(user.id)) {
        setNewUser(user);
        setIsCompletingProfile(true);
      } else {
        await handleSuccessfulLogin(user.name);
      }
    } catch (error: any) {
      if (isMultiFactorRequired(error)) {
        setMfaResolver(getTotpResolver(error));
        return;
      }
      toast({
        title: 'Erro no login com GitHub',
        description:
          error?.code === 'auth/account-exists-with-different-credential'
            ? 'Este e-mail já está vinculado a outro método de entrada (ex: E-mail ou Google).'
            : error?.message || 'Não foi possível concluir o login com GitHub.',
        variant: 'destructive',
      });
    } finally {
      setIsGithubLoading(false);
    }
  };

  const [consentOpen, setConsentOpen] = useState(false);

  const handleFederatedAuthStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!federatedMode || !federatedHandle.trim()) return;
    setConsentOpen(true);
  };

  const handleFederatedAuthConfirmed = async (consent: FederatedConsentChoice) => {
    if (!federatedMode || !federatedHandle.trim()) return;
    setIsFederatedLoading(true);
    try {
      const endpoint =
        federatedMode === 'fediverse' ? '/api/auth/fediverse/start' : '/api/auth/bluesky/start';
      const payload =
        federatedMode === 'fediverse'
          ? { instance: federatedHandle.trim(), locale, consent }
          : { handle: federatedHandle.trim(), locale, consent };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.message || 'Não foi possível iniciar o login.');
      }
      window.location.href = data.url;
    } catch (err: any) {
      toast({
        title: 'Falha ao conectar',
        description: err?.message || 'Verifique o endereço informado.',
        variant: 'destructive',
      });
      setIsFederatedLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = await loginUser(email, password, rememberMe); 
      if (user) {
        await handleSuccessfulLogin(user.name);
      } else {
        toast({ title: 'Falha no Login', description: 'E-mail ou senha inválidos.', variant: 'destructive' });
      }
    } catch (error: any) {
      if (isMultiFactorRequired(error)) {
        setMfaResolver(getTotpResolver(error));
      } else {
        toast({ title: 'Erro no Login', description: error.message || 'Ocorreu um erro inesperado.', variant: 'destructive' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpCode = async (code: string) => {
    if (!mfaResolver) return;
    const credential = await resolveTotpSignIn(mfaResolver, code);
    const user = await loadProfileAfterSignIn(credential.user.uid);
    setMfaResolver(null);
    await handleSuccessfulLogin(user.name);
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
        const { user, isNewUser } = await loginWithGoogle();
        if (isNewUser) {
            setNewUser(user);
            setIsCompletingProfile(true);
        } else if (user) {
            await handleSuccessfulLogin(user.name);
        }
    } catch (error: any) {
        if (isMultiFactorRequired(error)) {
          setMfaResolver(getTotpResolver(error));
        } else if (isSignupClosed(error)) {
          // Primeiro acesso com o Google depois das vagas iniciais: a conta não foi criada. Quem já tem conta entra normalmente.
          toast({
            title: tSignup('closedTitle'),
            description: `${tSignup('closedMessage', { limit: signupClosedLimit(error) ?? DEFAULT_SIGNUP_LIMIT })} ${tSignup('closedHint')}`,
            variant: 'destructive',
          });
        } else if (isAppCheckRequired(error)) {
          // O reCAPTCHA não confirmou que é uma pessoa: nada foi criado, é só tentar de novo.
          toast({ title: 'Erro com Login Google', description: tSignup('humanCheckFailed'), variant: 'destructive' });
        } else {
          toast({ title: 'Erro com Login Google', description: error.message || 'Não foi possível fazer login com o Google.', variant: 'destructive' });
        }
    } finally {
        setIsGoogleLoading(false);
    }
  };

  // Primeiro acesso com o Google: ao entrar, a sessão carrega e o layout troca a página por um esqueleto, então esta tela
  // é DESMONTADA e remontada com o estado zerado no meio do login. O marcador gravado por loginWithGoogle sobrevive a
  // isso: sempre que a sessão for a da conta recém-criada, o diálogo "Finalize seu Perfil" volta a aparecer.
  useEffect(() => {
    if (currentUser && !isCompletingProfile && isProfileCompletionPending(currentUser.id)) {
      setNewUser(currentUser);
      setIsCompletingProfile(true);
      return;
    }
    // Se a pessoa já está autenticada (e não clicou explicitamente em "Adicionar outra conta"),
    // nunca a deixe presa vendo a tela de Login (especialmente no celular onde não há barra lateral):
    // redireciona direto para o Feed com o Guia Rápido!
    const isAddingAnotherAccount = searchParams.get('addAccount') === '1';
    if (currentUser && !isCompletingProfile && !mfaResolver && !isAddingAnotherAccount) {
      const targetRedirect = safeRedirectPath(searchParams.get('redirect'), `/${locale}/?welcome=1`);
      router.replace(targetRedirect);
    }
  }, [currentUser, isCompletingProfile, mfaResolver, searchParams, locale, router]);

  const onProfileComplete = (completedUser: User) => {
      clearProfileCompletionPending();
      setIsCompletingProfile(false);
      setNewUser(null);
      handleSuccessfulLogin(completedUser.name);
  };

  if (isCompletingProfile && newUser) {
      return (
          <CompleteProfileDialog 
              user={newUser} 
              onProfileComplete={onProfileComplete} 
              onCancel={() => { clearProfileCompletionPending(); setIsCompletingProfile(false); }}
          />
      );
  }

  const isAddingAnotherAccount = searchParams.get('addAccount') === '1';
  const hasTicketInUrl = Boolean(searchParams.get('ticket'));
  if (hasTicketInUrl || (currentUser && !isAddingAnotherAccount && !mfaResolver)) {
    return (
      <div className="flex items-start justify-center bg-background px-4 pt-10 pb-10">
        <Card className="w-full max-w-sm rounded-2xl border-border/80 shadow-xl text-center p-6 space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-base font-bold text-foreground">
            {currentUser ? `Olá, ${currentUser.name}!` : 'Conectando sua conta...'}
          </p>
          <p className="text-xs text-muted-foreground">
            Abrindo seu Feed e preparando seus atalhos...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-center bg-background px-4 pt-4 sm:pt-6 pb-10">
      <TotpCodeDialog open={!!mfaResolver} onSubmit={handleTotpCode} onCancel={() => setMfaResolver(null)} />
      <ForgotPasswordDialog open={isForgotPasswordOpen} onOpenChange={setIsForgotPasswordOpen} initialEmail={email} />
      <Card className="w-full max-w-sm shadow-xl border-border">
        <CardHeader className="text-center pb-3">
          {searchParams.get('groupName') && (
            <div className="mb-3 rounded-xl border border-primary/35 bg-primary/10 px-3 py-2 text-xs text-foreground">
              <p className="font-semibold text-primary">
                Convite para o grupo &ldquo;{searchParams.get('groupName')}&rdquo;
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Entre abaixo para abrir a conversa do grupo.
              </p>
            </div>
          )}
          <CardTitle className="text-2xl font-bold flex items-center justify-center">
              <LogIn className="w-6 h-6 mr-2" />
              Login
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email" 
                placeholder="seu@email.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLoading || isGoogleLoading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <button type="button" onClick={() => setIsForgotPasswordOpen(true)} className="text-xs text-primary hover:underline">
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isLoading || isGoogleLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="remember-me" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked as boolean)} />
              <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer">Lembrar de mim</Label>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading || isGoogleLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
           <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                OU
                </span>
            </div>
          </div>
          <div className="space-y-3">
            <Label htmlFor="alt-login-method" className="text-xs text-muted-foreground">
              Entrar por protocolo ou outro provedor
            </Label>
            <Select
              value={altMethod}
              onValueChange={(value) => {
                setAltMethod(value);
                setDeviceLoginOpen(value === 'device');
                if (value.startsWith('fedi:')) {
                  setFederatedMode('fediverse');
                  setFederatedHandle(value.slice(5));
                } else if (value === 'fediverse' || value === 'bluesky') {
                  setFederatedMode(value);
                } else {
                  setFederatedMode(null);
                }
              }}
            >
              <SelectTrigger id="alt-login-method" className="w-full">
                <SelectValue placeholder="Escolha um protocolo ou provedor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Protocolos Abertos</SelectLabel>
                  <SelectItem value="device">
                    <span className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-primary" />
                      Dispositivo Conectado (@fulano@hiperverso.social)
                    </span>
                  </SelectItem>
                  <SelectItem value="fediverse">
                    <span className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" />
                      Fediverso BR / Outra instância (ActivityPub)
                    </span>
                  </SelectItem>
                  <SelectItem value="bluesky">
                    <span className="flex items-center gap-2">
                      <Cloud className="h-3.5 w-3.5" />
                      Atmosfera (AT Protocol · Bluesky)
                    </span>
                  </SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Comunidades do Fediverso BR</SelectLabel>
                  {BR_FEDIVERSE_INSTANCES.map((inst) => (
                    <SelectItem key={inst.domain} value={`fedi:${inst.domain}`}>
                      <span className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-emerald-500" />
                        {inst.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Contas &amp; Provedores</SelectLabel>
                  <SelectItem value="google">
                    <span className="flex items-center gap-2">
                      <GoogleIcon className="h-3.5 w-3.5" />
                      Google
                    </span>
                  </SelectItem>
                  {GITHUB_LOGIN_ENABLED && (
                    <SelectItem value="github">
                      <span className="flex items-center gap-2">
                        <Github className="h-3.5 w-3.5" />
                        GitHub
                      </span>
                    </SelectItem>
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>

            {altMethod === 'device' && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
                {!deviceChallenge ? (
                  <form onSubmit={handleDeviceLoginStart} className="space-y-2">
                    <Label htmlFor="device-login-handle" className="text-xs">
                      Seu @ no HiperVerso (ex: @fulano@hiperverso.social ou .app)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="device-login-handle"
                        value={deviceHandle}
                        onChange={(e) => setDeviceHandle(e.target.value)}
                        placeholder="@fulano@hiperverso.social"
                        disabled={isDeviceStartLoading}
                        required
                        className="h-8 text-sm"
                      />
                      <Button type="submit" size="sm" className="h-8 shrink-0" disabled={isDeviceStartLoading}>
                        {isDeviceStartLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Solicitar'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Enviaremos uma notificação em tempo real para o outro aparelho que já está conectado na sua conta.
                    </p>
                  </form>
                ) : (
                  <div className="space-y-2.5 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs font-medium text-foreground">
                      <Smartphone className="h-4 w-4 text-primary" />
                      <span>{deviceChallenge.account.federatedHandle}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Confirme este código na notificação do seu aparelho conectado:
                    </p>
                    <div className="py-2 px-3 rounded-md bg-background border border-primary/30 font-mono text-xl font-bold tracking-[0.2em] text-primary">
                      {deviceChallenge.verificationCode}
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span>Aguardando aprovação...</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setDeviceChallenge(null)}
                    >
                      Cancelar solicitação
                    </Button>
                  </div>
                )}
              </div>
            )}

            {(altMethod === 'fediverse' || altMethod.startsWith('fedi:') || altMethod === 'bluesky') && federatedMode && (
              <>
                <form onSubmit={handleFederatedAuthStart} className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
                <Label htmlFor="federated-handle" className="text-xs">
                  {federatedMode === 'fediverse'
                    ? 'Instância ou @ do Fediverso BR (ex: ursal.zone)'
                    : 'Seu @ na Atmosfera / Bluesky (ex: voce.bsky.social)'}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="federated-handle"
                    value={federatedHandle}
                    onChange={(e) => setFederatedHandle(e.target.value)}
                    placeholder={federatedMode === 'fediverse' ? 'ursal.zone' : 'voce.bsky.social'}
                    disabled={isFederatedLoading}
                    required
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" className="h-8 shrink-0" disabled={isFederatedLoading}>
                    {isFederatedLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Entrar'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Se ainda não tiver conta aqui, criaremos seu perfil automaticamente trazendo seus dados.
                </p>
                </form>
                <FederatedConsentDialog
                  open={consentOpen}
                  onOpenChange={setConsentOpen}
                  provider={federatedMode}
                  handleOrInstance={federatedHandle.trim()}
                  loading={isFederatedLoading}
                  onConfirm={(c) => void handleFederatedAuthConfirmed(c)}
                />
              </>
            )}

            {altMethod === 'google' && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isLoading || isGoogleLoading || isGithubLoading || isFederatedLoading}
              >
                {isGoogleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-4 w-4" />}
                Continuar com Google
              </Button>
            )}

            {GITHUB_LOGIN_ENABLED && altMethod === 'github' && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void handleGithubLogin()}
                disabled={isLoading || isGoogleLoading || isGithubLoading || isFederatedLoading}
              >
                {isGithubLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Github className="mr-2 h-4 w-4" />}
                Continuar com GitHub
              </Button>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-center text-sm px-6 pb-6">
          <p className="text-muted-foreground mt-4">
            Não tem uma conta?{' '}
            <Link href={`/${locale}/register`} className="font-medium text-primary hover:underline">
              Registre-se aqui
            </Link>
          </p>
          <Separator className="my-4" />
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <Link href={`/${locale}/about`} className="hover:underline">Sobre</Link>
            <Link href={`/${locale}/help`} className="hover:underline">Central de Ajuda</Link>
            <Link href={`/${locale}/terms`} className="hover:underline">Termos de Serviço</Link>
            <Link href={`/${locale}/privacy`} className="hover:underline">Política de Privacidade</Link>
            <Link href={`/${locale}/cookies`} className="hover:underline">Política de cookies</Link>
            <Link href={`/${locale}/accessibility`} className="hover:underline">Acessibilidade</Link>
          </div>
          <p className="text-xs text-muted-foreground mt-4">© 2026 HiperVerso.</p>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageSkeleton />}>
      <LoginPageContent />
    </Suspense>
  );
}
