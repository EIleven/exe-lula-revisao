
'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { UserPlus, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { loginUser } from '@/lib/services/authService'; // Import the login function
import { sendAccountVerificationEmail } from '@/lib/services/accountSecurity';
import { useLocale, useTranslations } from 'next-intl';
import { DEFAULT_SIGNUP_LIMIT, fetchSignupStatus, isAppCheckRequired, isSignupClosed, signupClosedLimit } from '@/lib/services/signupLimit';
import { firebaseEnv } from '@/config/firebase';
import { checkPassword, looksLikeEmail, normalizeEmail } from '@/lib/auth/password';
import { adultBirthDateMax, isAdultBirthDate } from '@/lib/auth/birthDate';

type ValidationStatus = 'idle' | 'checking' | 'available' | 'taken';

// Mesma regra que o servidor aplica no cadastro e na troca de @ (updateUserUsername).
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,15}$/;

const StatusIndicator = ({ status }: { status: ValidationStatus }) => {
  if (status === 'checking') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === 'available') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'taken') return <XCircle className="h-4 w-4 text-destructive" />;
  return null;
};

function RegisterPageSkeleton() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center">
          <Skeleton className="mx-auto mb-4 w-12 h-12 rounded-full" />
          <Skeleton className="h-7 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto mt-2" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(6)].map((_, i) => (
                <div className="space-y-2" key={i}>
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-10 w-full" />
                </div>
              ))}
          </div>
           <Skeleton className="h-10 w-full mt-6" />
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
  // O servidor recusou por falta do token anti-robô (App Check): o reCAPTCHA não confirmou que é uma pessoa.
  const [humanCheckFailed, setHumanCheckFailed] = useState(false);

  const debouncedUsername = useDebounce(username, 500);
  const router = useRouter();
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const locale = useLocale();
  const t = useTranslations('Signup');

  // Vagas iniciais preenchidas: avisa antes de a pessoa preencher o formulário. Só informativo (o servidor recusa de
  // qualquer jeito); se não deu para saber, a tela abre normalmente.
  const [closedLimit, setClosedLimit] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSignupStatus().then((status) => {
      if (!cancelled && status && !status.open) setClosedLimit(status.limit);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (USERNAME_PATTERN.test(debouncedUsername)) {
      setUsernameStatus('checking');
      checkAvailability({ type: 'username', value: debouncedUsername })
        .then(result => {
          const isAvailable = (result.data as { available: boolean }).available;
          setUsernameStatus(isAvailable ? 'available' : 'taken');
        })
        .catch(error => {
            console.error("Error checking username via function:", error);
            setUsernameStatus('idle'); // Reset on error
            if (isAppCheckRequired(error)) setHumanCheckFailed(true);
        });
    } else if (debouncedUsername.length > 0) {
      setUsernameStatus('idle');
    }
  }, [debouncedUsername]);

  // Nao consulta o servidor a cada tecla: isso revelaria quais enderecos ja
  // possuem conta. A existencia e provada pelo link enviado ao endereco.
  useEffect(() => {
    setEmailStatus(looksLikeEmail(email) ? 'available' : 'idle');
  }, [email]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    if (!USERNAME_PATTERN.test(username)) {
      toast({ title: 'Erro no Cadastro', description: t('usernameInvalid'), variant: 'destructive' });
      return;
    }
    if (usernameStatus !== 'available' || !looksLikeEmail(normalizedEmail)) {
      toast({ title: 'Erro no Cadastro', description: 'Por favor, corrija os erros antes de enviar.', variant: 'destructive' });
      return;
    }
    if (!isAdultBirthDate(dateOfBirth)) {
      toast({ title: 'Erro no Cadastro', description: 'Informe uma data valida e confirme ter 18 anos ou mais.', variant: 'destructive' });
      return;
    }
     if (password !== confirmPassword) {
      toast({ title: 'Erro no Cadastro', description: 'As senhas não coincidem.', variant: 'destructive' });
      return;
    }
    if (!checkPassword(password, normalizedEmail).ok) {
      toast({ title: 'Erro no Cadastro', description: 'Use uma senha mais forte, com pelo menos 8 caracteres.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const result = await createUserProfile({
          name,
          username,
          email: normalizedEmail,
          dateOfBirth,
          password
      });

      const { user } = result.data as { user: any };

      if (user) {
        // Automatically log the user in after successful registration (mantendo a sessão em todas as abas, como o
        // "Lembrar de mim" marcado do login; sem isso a conta nova aparecia deslogada em qualquer aba nova).
        await loginUser(normalizedEmail, password, true);
        await refreshCurrentUser();
        // Confirma que o e-mail é da pessoa (necessário para recuperar a conta e ativar a verificação em duas etapas).
        // Falhar aqui não impede o cadastro: dá para reenviar em Configurações.
        const verificationSent = await sendAccountVerificationEmail(locale, 'home').then(() => true, () => false);

        toast({
          title: 'Cadastro Realizado com Sucesso',
          description: verificationSent
            ? `Bem-vindo(a), ${user.name}! Enviamos um link para confirmar o seu e-mail.`
            : `Bem-vindo(a), ${user.name}!`,
        });
        
        // Redirect to the feed instead of a potentially different redirect path from query params
        router.push(`/${locale}/auth/verify-email`);
      }
    } catch (error: any) {
        if (isSignupClosed(error)) {
          // O servidor recusou: as vagas acabaram entre a tela abrir e o envio. Nada foi criado.
          setClosedLimit(signupClosedLimit(error) ?? DEFAULT_SIGNUP_LIMIT);
          return;
        }
        if (isAppCheckRequired(error)) {
          // Sem o token anti-robô nada é criado: avisa o que fazer em vez de um erro genérico.
          setHumanCheckFailed(true);
          return;
        }
        console.error("Registration error:", String(error));
        const unavailable = error?.code === 'functions/failed-precondition';
        toast({
          title: 'Erro no Cadastro',
          description: unavailable ? t('unavailable') : (error.message || 'Ocorreu um erro inesperado.'),
          variant: 'destructive',
        });
    } finally {
      setIsLoading(false);
    }
  };
  
  const isSubmitDisabled = isLoading || usernameStatus !== 'available' || emailStatus !== 'available';

  if (closedLimit !== null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md shadow-xl" data-testid="signup-closed">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <UserPlus className="w-12 h-12 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl">{t('closedTitle')}</CardTitle>
            <CardDescription className="text-base">{t('closedMessage', { limit: closedLimit })}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">{t('closedHint')}</CardContent>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href={`/${locale}/login`}>{t('goToLogin')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center">
           <div className="mx-auto mb-4">
            <UserPlus className="w-12 h-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">Crie sua Conta Exe. Lula</CardTitle>
          <CardDescription>Junte-se à conversa. É rápido e fácil.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome Completo</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Alice da Silva"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Nome de Usuário</Label>
                <div className="relative">
                  <Input
                    id="username"
                    type="text"
                    placeholder="alice_no_exelula"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    maxLength={15}
                    disabled={isLoading}
                    className={usernameStatus === 'taken' ? 'border-destructive focus-visible:ring-destructive' : (usernameStatus === 'available' ? 'border-green-500 focus-visible:ring-green-500' : '')}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <StatusIndicator status={usernameStatus} />
                  </div>
                </div>
                {username.length > 0 && !USERNAME_PATTERN.test(username) && <p className="text-xs text-destructive">{t('usernameInvalid')}</p>}
                {usernameStatus === 'taken' && <p className="text-xs text-destructive">Nome de usuário já está em uso.</p>}
                {usernameStatus === 'available' && <p className="text-xs text-green-500">Nome de usuário disponível.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    placeholder="alice@exemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    disabled={isLoading}
                    className={emailStatus === 'available' ? 'border-green-500 focus-visible:ring-green-500' : ''}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <StatusIndicator status={emailStatus} />
                  </div>
                </div>
                {emailStatus === 'available' && <p className="text-xs text-green-500">Formato de e-mail válido.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Data de Nascimento</Label>
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="•••••••• (mín. 6 caracteres)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isLoading}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute inset-y-0 right-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
               <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar Senha</Label>
                <div className="relative">
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
                    className={password && confirmPassword && password !== confirmPassword ? 'border-destructive focus-visible:ring-destructive' : ''}
                  />
                   <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute inset-y-0 right-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                 {password && confirmPassword && password !== confirmPassword && <p className="text-xs text-destructive">As senhas não coincidem.</p>}
              </div>
            </div>
            {humanCheckFailed && (
              <div role="alert" data-testid="human-check-failed" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {t('humanCheckFailed')}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registrando...</> : 'Registrar'}
            </Button>
            {firebaseEnv.recaptchaSiteKey && (
              <p className="text-center text-xs text-muted-foreground">{t('recaptchaNotice')}</p>
            )}
          </form>
        </CardContent>
        <CardFooter className="flex flex-col items-center text-sm space-y-3">
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Ou crie/entre direto com:</span>
            <Link href={`/${locale}/login?federated=fediverse`} className="font-medium text-primary hover:underline">
              Fediverso
            </Link>
            <span>•</span>
            <Link href={`/${locale}/login?federated=bluesky`} className="font-medium text-primary hover:underline">
              Atmosfera (Bluesky)
            </Link>
          </div>
          <p className="text-muted-foreground">
            Já tem uma conta?{' '}
            <Link href={`/${locale}/login`} className="font-medium text-primary hover:underline">
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
  )
}
