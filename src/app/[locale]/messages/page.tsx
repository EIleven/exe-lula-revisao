// src/app/[locale]/messages/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUserId } from '@/lib/services/authService';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, LogIn, MailPlus } from 'lucide-react';
import { NewConversationDialog } from '@/components/messages/NewConversationDialog';
import P2pNoticeBanner from '@/components/messages/P2pNoticeBanner';
import { useLocale } from 'next-intl';

export default function MessagesPage() {
  const [isNewConvoDialogOpen, setIsNewConvoDialogOpen] = useState(false);
  const currentUserId = getCurrentUserId();
  const router = useRouter();
  const locale = useLocale();

  if (!currentUserId) {
    return (
      <div className="container mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4 py-8">
        <Card className="w-full rounded-2xl border-border/80 shadow-xl">
          <CardHeader className="text-center space-y-3 pb-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-lg font-black tracking-tight text-primary">
              HV
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              HiperChat
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Mensagens diretas e em grupo sem rastreamento nem anúncios. Entre com sua conta HiperVerso ou pelo seu <span className="font-mono text-foreground">@</span> do Fediverso BR.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                Zero venda de dados
              </span>
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                Grupos até 1.000
              </span>
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                Modo P2P &amp; Fediverso
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-2">
            <Button onClick={() => router.push(`/${locale}/login`)} className="w-full rounded-full font-semibold">
              <LogIn className="mr-2 h-4 w-4" /> Entrar na minha conta
            </Button>
            <Button variant="outline" onClick={() => router.push(`/${locale}/register`)} className="w-full rounded-full">
              Criar conta gratuita
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <NewConversationDialog open={isNewConvoDialogOpen} onOpenChange={setIsNewConvoDialogOpen} />
      <div className="flex h-full w-full flex-col items-center justify-center px-8 py-12 text-center bg-background">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-muted/30">
          <MessageSquare className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Iniciar conversa
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Escolha entre as conversas existentes ou inicie uma nova
        </p>
        <Button
          onClick={() => setIsNewConvoDialogOpen(true)}
          className="mt-6 rounded-full px-6 font-semibold"
        >
          <MailPlus className="mr-2 h-4 w-4" />
          Novo chat
        </Button>
        <P2pNoticeBanner userId={currentUserId} className="mt-6 w-full max-w-md" />
      </div>
    </>
  );
}
