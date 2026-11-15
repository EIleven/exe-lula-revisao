// src/components/drafts/DraftsList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { cacheService, type Draft } from '@/lib/services/cacheService';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import CreatePostDialogContent from '@/components/feed/CreatePostDialogContent';
import CreateNewsDialogContent from '@/components/feed/CreateNewsDialogContent';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Edit, Trash2, FileText, MessageSquare } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Post } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

const DraftListItem = ({ draft, onEdit, onDelete }: { draft: Draft, onEdit: () => void, onDelete: () => void }) => {
  const previewText = draft.text ? 
    draft.text.replace(/<[^>]*>?/gm, ' ').substring(0, 100) + (draft.text.length > 100 ? '...' : '') :
    'Rascunho sem texto';

  const isNews = draft.draftType === 'news';
  const Icon = isNews ? FileText : MessageSquare;

  return (
    <div className="flex items-center justify-between p-4 border-b border-border last:border-b-0">
      <div className="flex items-center space-x-4 min-w-0">
        <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{draft.headline || previewText}</p>
          <p className="text-xs text-muted-foreground">
            Salvo em {format(draft.savedAt, "dd/MM/yyyy 'às' HH:mm")}
          </p>
        </div>
      </div>
      <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Edit className="mr-2 h-4 w-4" /> Editar
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="icon" className="h-9 w-9">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Isso excluirá permanentemente seu rascunho.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};


export default function DraftsList() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const locale = useLocale();

  const fetchDrafts = useCallback(async () => {
    setIsLoading(true);
    const allDrafts = await cacheService.getAllDrafts();
    setDrafts(allDrafts);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const handleDelete = async (draftId: string) => {
    await cacheService.deleteDraft(draftId);
    toast({ title: "Rascunho excluído" });
    fetchDrafts(); // Refresh the list
  };
  
  const handlePostCreated = (newPost: Post) => {
    if (editingDraft) {
      handleDelete(editingDraft.id); // Delete draft after successful post
      setEditingDraft(null);
    }
    toast({ title: "Postado com sucesso!" });
    router.push(`/${locale}/post/${newPost.id}`);
  };

  const handleEdit = (draft: Draft) => {
    setEditingDraft(draft);
  };
  
  const handleDialogClose = () => {
    setEditingDraft(null);
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (drafts.length === 0) {
    return <p className="p-6 text-center text-muted-foreground">Você não tem rascunhos salvos.</p>;
  }

  return (
    <div>
      {drafts.map(draft => (
        <DraftListItem
          key={draft.id}
          draft={draft}
          onEdit={() => handleEdit(draft)}
          onDelete={() => handleDelete(draft.id)}
        />
      ))}

      <Dialog open={!!editingDraft} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
        {editingDraft?.draftType === 'post' && (
          <CreatePostDialogContent
            initialData={editingDraft}
            onPostCreated={handlePostCreated}
            dialogClose={handleDialogClose}
          />
        )}
        {editingDraft?.draftType === 'news' && (
          <CreateNewsDialogContent
            initialData={editingDraft as any} // Cast needed as Draft is a partial
            onPostCreated={handlePostCreated}
            dialogClose={handleDialogClose}
          />
        )}
      </Dialog>
    </div>
  );
}
