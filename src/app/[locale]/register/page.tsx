'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import {
  UserPlus,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  Globe,
  Lock,
  Sparkles,
  AtSign,
  User as UserIcon,
  Mail,
  Calendar,
  Cloud,
  ArrowRight,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { loginUser } from '@/lib/services/authService';
import { sendAccountVerificationEmail } from '@/lib/services/accountSecurity';
import { useLocale, useTranslations } from 'next-intl';
import {
  DEFAULT_SIGNUP_LIMIT,
  fetchSignupStatus,
  isAppCheckRequired,
  isSignupClosed,
  signupClosedLimit,
} from '@/lib/services/signupLimit';
import { firebaseEnv } from '@/config/firebase';
import { checkPassword, looksLikeEmail, normalizeEmail } from '@/lib/auth/password';
import { adultBirthDateMax, isAdultBirthDate } from '@/lib/auth/birthDate';
import { cn } from '@/lib/utils';

type ValidationStatus = 'idle' | 'checking' | 'available' | 'taken';

// Mesma regra que o servidor aplica no cadastro e na troca de @ (updateUserUsername).
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,15}$/;

const StatusIndicator = ({ status }: { status: ValidationStatus }) => {
  if (status === 'checking')
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === 'available')
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === 'taken')
    return <XCircle className="h-4 w-4 text-destructive" />;
  return null;
};

function RegisterPageSkeleton() {
  return (
    <div className="flex items-start justify-center bg-background px-3 sm:px-5 pt-3 sm:pt-5 pb-10">
      <Card className="w-full max-w-2xl overflow-hidden rounded-2xl border-border/80 shadow-2xl">
        <CardHeader className="space-y-3 pb-4">
          <Skeleton className="h-6 w-48 rounded-full" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div className="space-y-2" key={i}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
          <Skeleton className="h-11 w-full mt-6 rounded-full" />
        </CardContent>
        <CardFooter className="flex flex-col items-center text-sm">
          <Skeleton className="h-4 w-48" />
        </CardFooter>
      </Card>
    </div>
  );
}

const checkAvailability = httpsCallable(functions, 'checkAvailability');
const createUserProfile = httpsCallable(functions, 'createUserProfile');

function RegisterPageContent() {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState<ValidationStatus>('idle');
  const [emailStatus, setEmailStatus] = useState<ValidationStatus>('idle');
  const [humanCheckFailed, setHumanCheckFailed] = useState(false);

  const debouncedUsername = useDebounce(username, 500);
  const router = useRouter();
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const locale = useLocale();
  const t = useTranslations('Signup');

  const [closedLimit, setClosedLimit] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSignupStatus().then((status) => {
      if (!cancelled && status && !status.open) setClosedLimit(status.limit);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (USERNAME_PATTERN.test(debouncedUsername)) {
      setUsernameStatus('checking');
      checkAvailability({ type: 'username', value: debouncedUsername })
        .then((result) => {
          const isAvailable = (result.data as { available: boolean }).available;
          setUsernameStatus(isAvailable ? 'available' : 'taken');
        })
        .catch((error) => {
          console.error('Error checking username via function:', error);
          setUsernameStatus('idle');
          if (isAppCheckRequired(error)) setHumanCheckFailed(true);
        });
    } else if (debouncedUsername.length > 0) {
      setUsernameStatus('idle');
    } else {
      setUsernameStatus('idle');
    }
  }, [debouncedUsername]);

  useEffect(() => {
    setEmailStatus(looksLikeEmail(email) ? 'available' : 'idle');
  }, [email]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    if (!USERNAME_PATTERN.test(username)) {
      toast({
        title: 'Erro no Cadastro',
        description: t('usernameInvalid'),
        variant: 'destructive',
      });
      return;
    }
    if (usernameStatus !== 'available' || !looksLikeEmail(normalizedEmail)) {
      toast({
        title: 'Erro no Cadastro',
        description: 'Por favor, corrija os erros antes de enviar.',
        variant: 'destructive',
      });
      return;
    }
    if (!isAdultBirthDate(dateOfBirth)) {
      toast({
        title: 'Erro no Cadastro',
        description: 'Informe uma data valida e confirme ter 18 anos ou mais.',
        variant: 'destructive',
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({
        title: 'Erro no Cadastro',
        description: 'As senhas não coincidem.',
        variant: 'destructive',
      });
      return;
    }
    if (!checkPassword(password, normalizedEmail).ok) {
      toast({
        title: 'Erro no Cadastro',
        description: 'Use uma senha mais forte, com pelo menos 8 caracteres.',
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    try {
      const result = await createUserProfile({
        name,
        username,
        email: normalizedEmail,
        dateOfBirth,
        password,
      });

      const { user } = result.data as { user: any };

      if (user) {
        await loginUser(normalizedEmail, password, true);
        await refreshCurrentUser();
        const verificationSent = await sendAccountVerificationEmail(locale, 'home').then(
          () => true,
          () => false
        );

        toast({
          title: 'Cadastro Realizado com Sucesso',
          description: verificationSent
            ? `Bem-vindo(a), ${user.name}! Enviamos um link para confirmar o seu e-mail.`
            : `Bem-vindo(a), ${user.name}!`,
        });

        router.push(`/${locale}/auth/verify-email`);
      }
    } catch (error: any) {
      if (isSignupClosed(error)) {
        setClosedLimit(signupClosedLimit(error) ?? DEFAULT_SIGNUP_LIMIT);
        return;
      }
      if (isAppCheckRequired(error)) {
        setHumanCheckFailed(true);
        return;
      }
      console.error('Registration error:', String(error));
      const unavailable = error?.code === 'functions/failed-precondition';
      toast({
        title: 'Erro no Cadastro',
        description: unavailable
          ? t('unavailable')
          : error.message || 'Ocorreu um erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isSubmitDisabled =
    isLoading || usernameStatus !== 'available' || emailStatus !== 'available';

  const passwordStrongEnough = password.length >= 8;
  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const adultConfirmed = dateOfBirth ? isAdultBirthDate(dateOfBirth) : false;

  if (closedLimit !== null) {
    return (
      <div className="flex items-start justify-center bg-background px-4 pt-6 pb-10">
        <Card className="w-full max-w-md rounded-2xl border-border/80 shadow-xl" data-testid="signup-closed">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
              <UserPlus className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">{t('closedTitle')}</CardTitle>
            <CardDescription className="text-base">
              {t('closedMessage', { limit: closedLimit })}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            {t('closedHint')}
          </CardContent>
          <CardFooter className="justify-center">
            <Button asChild className="rounded-full px-6">
              <Link href={`/${locale}/login`}>{t('goToLogin')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-center bg-background px-3 sm:px-5 pt-2 sm:pt-4 pb-10">
      <Card className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.75)]">
        {/* Top Sovereign Accent Line */}
        <div
          aria-hidden="true"
          className="h-1 w-full bg-gradient-to-r from-primary/80 via-primary to-amber-500/70"
        />

        {/* Header Interativo — aprende fazendo, sem textão */}
        <div className="relative border-b border-border/60 bg-[radial-gradient(120%_100%_at_0%_0%,hsl(var(--primary)/0.14),transparent_65%)] px-5 pt-5 pb-4 sm:px-7 sm:pt-5 sm:pb-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-background/90">
                <img
                  src="/brand/lula-logo.svg"
                  alt="HiperVerso"
                  className="h-6 w-6 object-contain"
                />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Criar conta
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Monte seu perfil abaixo ou entre com 1 toque.
                </CardDescription>
              </div>
            </div>
            <Link
              href={`/${locale}/login`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <span>Já tem conta?</span>
              <span className="font-semibold text-primary">Entrar</span>
              <ArrowRight className="h-3 w-3 text-primary" />
            </Link>
          </div>

          {/* Cartão de Perfil ao Vivo — mostra na prática como fica na rede */}
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/75 px-3.5 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/35 text-sm font-bold text-primary">
                {(name.trim() || username.trim() || 'H').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {name.trim() || 'Seu nome aparece aqui'}
                </p>
                <p className="truncate text-xs font-mono text-muted-foreground">
                  @{username.trim() || 'seu_usuario'}
                  <span className="text-primary/80">@hiperverso.app</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {usernameStatus === 'available' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> @ livre
                </span>
              ) : usernameStatus === 'taken' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-[11px] font-medium text-destructive">
                  <XCircle className="h-3 w-3" /> @ em uso
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  <AtSign className="h-3 w-3 text-primary" /> Escolha seu @
                </span>
              )}
            </div>
          </div>
        </div>

        <CardContent className="px-5 pt-5 pb-4 sm:px-7">
          {/* Quick Federated Entry Strip */}
          <div className="mb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Link
                href={`/${locale}/login?federated=fediverse`}
                className="flex items-center justify-center gap-2 rounded-xl border border-border/80 bg-muted/25 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                <Globe className="h-3.5 w-3.5 text-primary" />
                <span>Entrar com Fediverso (Mastodon / Organica)</span>
              </Link>
              <Link
                href={`/${locale}/login?federated=bluesky`}
                className="flex items-center justify-center gap-2 rounded-xl border border-border/80 bg-muted/25 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                <Cloud className="h-3.5 w-3.5 text-sky-400" />
                <span>Entrar com Atmosfera (Bluesky)</span>
              </Link>
            </div>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-[10px] font-semibold uppercase tracking-widest">
                <span className="bg-card px-3 text-muted-foreground">
                  ou crie sua conta nativa
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-semibold">
                  Nome Completo ou Apelido
                </Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="Alice da Silva"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    disabled={isLoading}
                    className="pl-9 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-semibold">
                  Nome de Usuário (@)
                </Label>
                <div className="relative">
                  <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="alice_hiperverso"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    maxLength={15}
                    disabled={isLoading}
                    className={cn(
                      'pl-9 pr-9 rounded-xl font-mono text-sm',
                      usernameStatus === 'taken' &&
                        'border-destructive focus-visible:ring-destructive',
                      usernameStatus === 'available' &&
                        'border-emerald-500 focus-visible:ring-emerald-500'
                    )}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <StatusIndicator status={usernameStatus} />
                  </div>
                </div>
                {username.length > 0 && !USERNAME_PATTERN.test(username) && (
                  <p className="text-[11px] text-destructive">{t('usernameInvalid')}</p>
                )}
                {usernameStatus === 'taken' && (
                  <p className="text-[11px] text-destructive">
                    Nome de usuário já está em uso.
                  </p>
                )}
                {usernameStatus === 'available' && (
                  <p className="text-[11px] text-emerald-400">
                    Nome de usuário disponível.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold">
                  E-mail
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="alice@exemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    disabled={isLoading}
                    className={cn(
                      'pl-9 pr-9 rounded-xl',
                      emailStatus === 'available' &&
                        'border-emerald-500 focus-visible:ring-emerald-500'
                    )}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <StatusIndicator status={emailStatus} />
                  </div>
                </div>
                {emailStatus === 'available' && (
                  <p className="text-[11px] text-emerald-400">Formato de e-mail válido.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dateOfBirth" className="text-xs font-semibold">
                  Data de Nascimento (18+)
                </Label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="dateOfBirth"
                    type="date"
                    min="1900-01-01"
                    max={adultBirthDateMax()}
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                    autoComplete="bday"
                    disabled={isLoading}
                    className="pl-9 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold">
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="•••••••• (mín. 8 caracteres)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isLoading}
                    className="pl-9 pr-10 rounded-xl"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-xs font-semibold">
                  Confirmar Senha
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isLoading}
                    className={cn(
                      'pl-9 pr-10 rounded-xl',
                      password &&
                        confirmPassword &&
                        password !== confirmPassword &&
                        'border-destructive focus-visible:ring-destructive',
                      passwordsMatch && 'border-emerald-500 focus-visible:ring-emerald-500'
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {password && confirmPassword && password !== confirmPassword && (
                  <p className="text-[11px] text-destructive">As senhas não coincidem.</p>
                )}
              </div>
            </div>

            {/* Live Readiness Indicators */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors',
                  passwordStrongEnough
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-border/70 bg-muted/30 text-muted-foreground'
                )}
              >
                <CheckCircle2 className="h-3 w-3" /> Senha forte (8+ caracteres)
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors',
                  passwordsMatch
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-border/70 bg-muted/30 text-muted-foreground'
                )}
              >
                <CheckCircle2 className="h-3 w-3" /> Senhas iguais
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors',
                  adultConfirmed
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-border/70 bg-muted/30 text-muted-foreground'
                )}
              >
                <CheckCircle2 className="h-3 w-3" /> Maior de 18 anos
              </span>
            </div>

            {humanCheckFailed && (
              <div
                role="alert"
                data-testid="human-check-failed"
                className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {t('humanCheckFailed')}
              </div>
            )}

            <Button
              type="submit"
              className="h-11 w-full rounded-full text-sm font-bold shadow-md transition-all"
              disabled={isSubmitDisabled}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Criando conta...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" /> Criar conta
                </>
              )}
            </Button>

            {firebaseEnv.recaptchaSiteKey && (
              <p className="text-center text-[11px] text-muted-foreground">
                {t('recaptchaNotice')}
              </p>
            )}
          </form>
        </CardContent>

        <CardFooter className="flex flex-col items-center border-t border-border/50 bg-muted/15 px-5 py-3.5 text-xs text-muted-foreground">
          <p>
            Já tem uma conta no HiperVerso?{' '}
            <Link
              href={`/${locale}/login`}
              className="font-semibold text-primary hover:underline"
            >
              Entre aqui
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterPageSkeleton />}>
      <RegisterPageContent />
    </Suspense>
  );
}
