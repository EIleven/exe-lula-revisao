// src/app/breaknews/page.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Link as LinkIcon, Newspaper, Share2, Bookmark } from 'lucide-react';
import Image from 'next/image';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import CreateNewsDialogContent from '@/components/feed/CreateNewsDialogContent';
import type { Post } from '@/lib/types';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { sanitizeHtml } from '@/lib/security/sanitizeHtml';
import { auth } from '@/lib/firebase';

interface ExtractedContent {
  title: string;
  textContent: string;
  mainImageUrl: string | null;
  source: string;
}

const MIN_TEXT_LENGTH = 100; // Minimum characters to consider a successful extraction
const MAX_RETRIES = 3;
const RETRY_DELAY = 1500; // 1.5 seconds

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function BreakNewsPage() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] = useState<ExtractedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreateNewsDialogOpen, setIsCreateNewsDialogOpen] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const { toast } = useToast();
  const { currentUser } = useCurrentUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContent(null);
    setError(null);
    setAttemptCount(0); // Reset on new submission

    // A extração roda no nosso servidor e exige conta (o token prova quem pede).
    const idToken = await auth.currentUser?.getIdToken().catch(() => null);
    if (!idToken) {
      const message = 'Entre na sua conta para extrair artigos.';
      setError(message);
      toast({ title: 'Login necessário', description: message, variant: 'destructive' });
      return;
    }
    setIsLoading(true);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      setAttemptCount(attempt); // Update attempt count for UI
      try {
        const response = await fetch('/api/extract-article', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ url }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          // 403 (o site bloqueia), 401 (sessão) e 429 (limite) são definitivos: não adianta repetir.
          if (response.status === 403 || response.status === 401 || response.status === 429) {
            throw Object.assign(new Error(errorData.message || 'O site de origem está bloqueando nosso acesso.'), { definitive: true });
          }
          // For other server errors (like 502), we will retry.
          throw new Error(errorData.message || `Falha ao extrair conteúdo do servidor (status: ${response.status}).`);
        }

        const data: ExtractedContent = await response.json();
        
        // Check if the extracted text content is substantial enough
        const plainText = data.textContent.replace(/<[^>]*>?/gm, ' ').trim();
        if (plainText.length >= MIN_TEXT_LENGTH) {
          setContent(data);
          setIsLoading(false);
          setAttemptCount(0);
          return; // Success, exit the loop
        }
        
        // If content is too short, and it's not the last attempt, wait and retry.
        if (attempt < MAX_RETRIES) {
          console.log(`Attempt ${attempt} failed: content too short. Retrying in ${RETRY_DELAY}ms...`);
          await sleep(RETRY_DELAY);
        } else {
          // If this was the last attempt and still failed, set the content anyway
          // or throw a specific error. Setting content allows user to see what was extracted.
          setContent(data);
          toast({
            title: 'Extração Parcial',
            description: 'Não foi possível extrair o corpo principal do artigo, mas o título e a imagem foram recuperados.',
            variant: 'default',
          });
        }

      } catch (err: any) {
        // If the error is a definitive block (from our 403 handler), or if we're on the last attempt, stop.
        if (err.definitive || err.message.includes('bloqueando') || attempt === MAX_RETRIES) {
            setError(err.message);
            toast({
              title: 'Erro na Extração',
              description: err.message,
              variant: 'destructive',
            });
            setIsLoading(false);
            setAttemptCount(0);
            return; // Exit the loop immediately
        }
         // Log retry attempts for transient errors
        console.log(`Attempt ${attempt} failed with error: ${err.message}. Retrying...`);
        await sleep(RETRY_DELAY);
      }
    }
    
    setIsLoading(false);
    setAttemptCount(0);
  };

  
  const handlePostCreated = (newPost: Post) => {
    toast({ title: "Artigo Publicado!", description: "Seu artigo de notícia agora está no ar." });
    setIsCreateNewsDialogOpen(false);
    // Optionally, you could redirect to the new post or clear the form
    // For now, we just close the dialog.
  };
  
  const handleSaveArticle = () => {
      toast({
          title: "Funcionalidade não implementada",
          description: "Salvar artigos para mais tarde estará disponível em breve!",
      });
  };

  return (
    <>
      {/* Dialog for creating a news article from the extracted content */}
      <Dialog open={isCreateNewsDialogOpen} onOpenChange={setIsCreateNewsDialogOpen}>
        {content && currentUser && (
          <CreateNewsDialogContent
            onPostCreated={handlePostCreated}
            dialogClose={() => setIsCreateNewsDialogOpen(false)}
            initialData={{
              headline: content.title,
              text: content.textContent,
              sourceUrl: url,
              imageUrl: content.mainImageUrl
            }}
          />
        )}
      </Dialog>
      
      <div className="container mx-auto max-w-3xl py-8">
        <Card className="shadow-lg rounded-none">
          <CardHeader>
            <CardTitle className="flex items-center text-2xl font-bold">
              <Newspaper className="mr-3 h-6 w-6 text-primary" />
              BreakNews
            </CardTitle>
            <CardDescription>
              Cole a URL de um artigo para lê-lo aqui em um formato simplificado e limpo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="url"
                  placeholder="https://exemplo.com.br/artigo"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  className="pl-9"
                  disabled={isLoading}
                />
              </div>
              <Button type="submit" disabled={isLoading || !url}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? `Tentando... (${attemptCount})` : 'Extrair'}
              </Button>
            </form>

            {error && <p className="text-destructive mt-4 text-center">{error}</p>}
          </CardContent>
        </Card>

        {content && (
          <Card className="mt-8 shadow-lg rounded-none">
            <CardHeader>
              {content.mainImageUrl && (
                <div className="relative aspect-video w-full mb-4 rounded-lg overflow-hidden border">
                  <Image src={content.mainImageUrl} alt={content.title} layout="fill" objectFit="cover" />
                </div>
              )}
              <CardTitle className="text-3xl font-bold">{content.title}</CardTitle>
              <CardDescription>
                Fonte: <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{content.source}</a>
              </CardDescription>
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button variant="outline" onClick={handleSaveArticle}>
                    <Bookmark className="mr-2 h-4 w-4" />
                    Salvar Artigo
                  </Button>
                  <Button onClick={() => setIsCreateNewsDialogOpen(true)} disabled={!currentUser}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Compartilhar como Artigo
                  </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div
                className="prose prose-lg dark:prose-invert max-w-none"
                // O HTML vem de uma página EXTERNA: sem higienizar, o site extraído rodava script aqui.
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(content.textContent) }}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
