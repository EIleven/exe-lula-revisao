
'use client';

import { useState, useEffect, Suspense } from 'react';
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
import { signInWithCustomToken, type MultiFactorResolver } from 'firebase/auth';
import Link from 'next/link';
import { LogIn, Eye, EyeOff, Loader2, Globe, Cloud } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import CompleteProfileDialog from '@/components/auth/CompleteProfileDialog';
import type { User } from '@/lib/types';
import { useLocale, useTranslations } from 'next-intl';
import { DEFAULT_SIGNUP_LIMIT, isAppCheckRequired, isSignupClosed, signupClosedLimit } from '@/lib/services/signupLimit';
import { Checkbox } from "@/components/ui/checkbox";
import { auth } from '@/lib/firebase';

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
  const [isCompletingProfile, setIsCompletingProfile] = useState(false);
  const [newUser, setNewUser] = useState<User | null>(null);
  // Conta com verificação em duas etapas: depois da senha (ou do Google), o código do app autenticador.
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [federatedMode, setFederatedMode] = useState<'fediverse' | 'bluesky' | null>(null);
  const [federatedHandle, setFederatedHandle] = useState('');
  const [isFederatedLoading, setIsFederatedLoading] = useState(false);
  const locale = useLocale();
  const tSignup = useTranslations('Signup');

  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { refreshCurrentUser, currentUser } = useCurrentUser();

  const handleSuccessfulLogin = async (userName: string) => {
    await refreshCurrentUser();
    toast({ title: 'Login bem-sucedido', description: `Bem-vindo(a), ${userName}!` });
    if (auth.currentUser && auth.currentUser.email && !auth.currentUser.emailVerified) {
      router.push(`/${locale}/auth/verify-email`);
      return;
    }
    router.push(safeRedirectPath(searchParams.get('redirect'), `/${locale}/`));
  };

  useEffect(() => {
    const preselected = searchParams.get('federated');
    if (preselected === 'fediverse' || preselected === 'bluesky') {
      setFederatedMode(preselected);
    }
    const authError = searchParams.get('auth_error');
    if (authError) {
      toast({
        title: 'Erro na autenticação externa',
        description: 'Não foi possível concluir o login com a rede externa. Tente novamente.',
        variant: 'destructive',
      });
    }
    const ticket = searchParams.get('ticket');
    if (!ticket) return;
    let cancelled = false;
    setIsFederatedLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/auth/ticket?ticket=${encodeURIComponent(ticket)}`);
        if (!res.ok) throw new Error('Ticket inválido ou expirado.');
        const data = (await res.json()) as { customToken: string; uid: string; isNewUser: boolean };
        if (cancelled) return;
        await signInWithCustomToken(auth, data.customToken);
        const user = await loadProfileAfterSignIn(data.uid);
        if (cancelled) return;
        await refreshCurrentUser();
        toast({
          title: data.isNewUser ? 'Conta criada via rede federada!' : 'Login bem-sucedido',
          description: `Bem-vindo(a), ${user.name}!`,
        });
        router.push(`/${locale}/`);
      } catch (err: any) {
        if (!cancelled) {
          toast({
            title: 'Erro ao entrar',
            description: err?.message || 'Não foi possível concluir o login.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setIsFederatedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, locale, router, refreshCurrentUser, toast]);

  const handleFederatedAuthStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!federatedMode || !federatedHandle.trim()) return;
    setIsFederatedLoading(true);
    try {
      const endpoint =
        federatedMode === 'fediverse' ? '/api/auth/fediverse/start' : '/api/auth/bluesky/start';
      const payload =
        federatedMode === 'fediverse'
          ? { instance: federatedHandle.trim(), locale }
          : { handle: federatedHandle.trim(), locale };
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
    }
  }, [currentUser, isCompletingProfile]);

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

  return (
    <div className="flex justify-center bg-background p-4 pt-20">
      <TotpCodeDialog open={!!mfaResolver} onSubmit={handleTotpCode} onCancel={() => setMfaResolver(null)} />
      <ForgotPasswordDialog open={isForgotPasswordOpen} onOpenChange={setIsForgotPasswordOpen} initialEmail={email} />
      <Card className="w-full max-w-sm shadow-xl border-border">
        <CardHeader className="text-center">
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
           <Button variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={isLoading || isGoogleLoading || isFederatedLoading}>
            {isGoogleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-4 w-4" />}
            Entrar com Google
          </Button>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Button
              type="button"
              variant={federatedMode === 'fediverse' ? 'secondary' : 'outline'}
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setFederatedMode((m) => (m === 'fediverse' ? null : 'fediverse'));
                setFederatedHandle('');
              }}
              disabled={isLoading || isGoogleLoading || isFederatedLoading}
            >
              <Globe className="mr-1.5 h-3.5 w-3.5" />
              Fediverso
            </Button>
            <Button
              type="button"
              variant={federatedMode === 'bluesky' ? 'secondary' : 'outline'}
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setFederatedMode((m) => (m === 'bluesky' ? null : 'bluesky'));
                setFederatedHandle('');
              }}
              disabled={isLoading || isGoogleLoading || isFederatedLoading}
            >
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              Atmosfera
            </Button>
          </div>
          {federatedMode && (
            <form onSubmit={handleFederatedAuthStart} className="mt-3 p-3 rounded-lg border border-border bg-muted/30 space-y-2">
              <Label htmlFor="federated-handle" className="text-xs">
                {federatedMode === 'fediverse'
                  ? 'Servidor ou @ do Fediverso (ex: mastodon.social)'
                  : 'Seu @ na Atmosfera / Bluesky (ex: voce.bsky.social)'}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="federated-handle"
                  value={federatedHandle}
                  onChange={(e) => setFederatedHandle(e.target.value)}
                  placeholder={federatedMode === 'fediverse' ? 'mastodon.social' : 'voce.bsky.social'}
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
          )}
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
            <Link href={`/${locale}/ads-info`} className="hover:underline">Informações de anúncios</Link>
          </div>
          <p className="text-xs text-muted-foreground mt-4">© 2026 Exe. Lula.</p>
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
