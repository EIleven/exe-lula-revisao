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
      <div className="container mx-auto max-w-3xl py-8 text-center">
        <Card className="shadow-lg inline-block">
          <CardHeader>
            <CardTitle className="flex items-center justify-center text-2xl">
              <MessageSquare className="mr-3 h-7 w-7 text-primary" />
              Mensagens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive mb-4">
              Por favor, faça login para ver suas mensagens.
            </p>
            <Button onClick={() => router.push(`/${locale}/login`)}>
              <LogIn className="mr-2 h-4 w-4" /> Login
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
