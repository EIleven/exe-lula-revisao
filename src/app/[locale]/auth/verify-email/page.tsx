'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { MailCheck, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { refreshEmailVerified, sendAccountVerificationEmail } from '@/lib/services/accountSecurity';

const COOLDOWN_SECONDS = 60;

export default function VerifyEmailPage() {
  const locale = useLocale();
  const router = useRouter();
  const { firebaseUser, refreshCurrentUser } = useCurrentUser();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (firebaseUser?.emailVerified) router.replace(`/${locale}/`);
  }, [firebaseUser, locale, router]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  const resend = async () => {
    setSending(true);
    try {
      await sendAccountVerificationEmail(locale, 'home');
      setRemaining(COOLDOWN_SECONDS);
      toast({title: 'E-mail enviado', description: 'Confira a caixa de entrada e a pasta de spam.'});
    } catch (error) {
      toast({
        title: 'Não foi possível enviar',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      if (await refreshEmailVerified()) {
        await refreshCurrentUser();
        router.replace(`/${locale}/`);
      } else {
        toast({title: 'Ainda não confirmado', description: 'Abra o link recebido e tente novamente.'});
      }
    } catch (error) {
      toast({title: 'Falha ao conferir', description: (error as Error).message, variant: 'destructive'});
    } finally {
      setChecking(false);
    }
  };

  if (!firebaseUser) {
    return (
      <div className="mx-auto max-w-md p-4 pt-16">
        <Card><CardContent className="space-y-4 pt-6">
          <p>Entre na conta para conferir a confirmação do e-mail.</p>
          <Button asChild><Link href={`/${locale}/login`}>Entrar</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MailCheck /> Confirme seu e-mail</CardTitle>
          <CardDescription>
            Enviamos um link para {firebaseUser.email}. Isso comprova a posse do endereço, não a identidade civil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert><AlertDescription>
            Enquanto estiver pendente, você pode ler a rede, ajustar a conta, exportar ou excluir seus dados. Publicar,
            interagir, enviar mensagens e arquivos fica bloqueado.
          </AlertDescription></Alert>
          <Button className="w-full" onClick={check} disabled={checking}>
            {checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Já confirmei
          </Button>
          <Button className="w-full" variant="outline" onClick={resend} disabled={sending || remaining > 0}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {remaining > 0 ? `Reenviar em ${remaining}s` : 'Reenviar e-mail'}
          </Button>
          <Button asChild className="w-full" variant="ghost">
            <Link href={`/${locale}/settings/account`}>Corrigir o endereço na conta</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
