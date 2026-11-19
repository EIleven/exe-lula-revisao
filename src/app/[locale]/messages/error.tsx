'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MessagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    console.error('[MessagesError]', error);
  }, [error]);

  return (
    <div className="flex h-full w-full items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <CardTitle className="text-lg">Não foi possível abrir esta conversa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Ocorreu uma falha temporária ao carregar o chat. Você pode tentar novamente ou voltar para a lista de mensagens.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={() => reset()}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Tentar novamente
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/${locale}/messages`)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Voltar para Mensagens
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

