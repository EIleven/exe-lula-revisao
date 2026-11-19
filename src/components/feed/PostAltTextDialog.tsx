// src/components/feed/PostAltTextDialog.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Accessibility, CheckCircle2, Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import type { Media, Post } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { haptics } from '@/lib/haptics';

interface PostAltTextDialogProps {
  post: Post;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMediaUpdated?: (updatedMedia: Media[]) => void;
}

const MAX_ALT_LENGTH = 300;

export default function PostAltTextDialog({
  post,
  open,
  onOpenChange,
  onMediaUpdated,
}: PostAltTextDialogProps) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const imageEntries = (post.media || [])
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.type === 'image');

  useEffect(() => {
    if (!open) return;
    const initial: Record<number, string> = {};
    (post.media || []).forEach((item, idx) => {
      if (item.type === 'image') {
        initial[idx] = item.alt || '';
      }
    });
    setDrafts(initial);
  }, [open, post.media]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) {
        throw new Error('Sessão expirada. Entre novamente para salvar.');
      }
      const alts = imageEntries.map(({ index }) => ({
        index,
        alt: (drafts[index] || '').trim().slice(0, MAX_ALT_LENGTH),
      }));

      const res = await fetch('/api/posts/alt-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId: post.id, alts }),
      });
      const json = (await res.json().catch(() => null)) as { media?: Media[]; error?: string } | null;
      if (!res.ok || !json?.media) {
        throw new Error(json?.error || 'Não foi possível salvar o Alt Text.');
      }

      onMediaUpdated?.(json.media);
      haptics.success();
      toast({
        title: 'Alt Text salvo!',
        description: 'As imagens agora possuem descrição acessível para leitores de tela.',
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Erro ao salvar Alt Text',
        description: err instanceof Error ? err.message : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90dvh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-border/80 bg-card p-0 shadow-2xl sm:max-w-lg"
        onClick={(e) => e.stopPropagation()}
        data-interactive="true"
      >
        <DialogHeader className="shrink-0 border-b border-border/60 p-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-bold">
            <Accessibility className="h-5 w-5 text-emerald-500 shrink-0" />
            Descrição das imagens (Alt Text)
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Descreva quem aparece, o cenário e qualquer texto importante na imagem para quem usa leitor de tela.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          {imageEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Este post não possui imagens para descrever.
            </p>
          ) : (
            imageEntries.map(({ item, index }, listIdx) => {
              const value = drafts[index] ?? '';
              const hasFilled = value.trim().length > 0;
              return (
                <div
                  key={`${item.url}-${index}`}
                  className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={value || `Imagem ${listIdx + 1}`}
                      className="h-16 w-16 shrink-0 rounded-lg object-cover border border-border/60 bg-muted"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`post-alt-${post.id}-${index}`} className="text-xs font-semibold">
                          Imagem {listIdx + 1} de {imageEntries.length}
                        </Label>
                        {hasFilled && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500">
                            <CheckCircle2 className="h-3 w-3" /> Preenchido
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Seja direto(a) e objetivo(a) · até {MAX_ALT_LENGTH} caracteres
                      </p>
                    </div>
                  </div>
                  <Textarea
                    id={`post-alt-${post.id}-${index}`}
                    value={value}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [index]: e.target.value,
                      }))
                    }
                    placeholder="Ex: Foto ao ar livre mostrando..."
                    maxLength={MAX_ALT_LENGTH}
                    rows={3}
                    className="text-sm resize-y"
                  />
                  <div className="text-right text-[11px] text-muted-foreground tabular-nums">
                    {value.length}/{MAX_ALT_LENGTH}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 p-4 px-5 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || imageEntries.length === 0}
            className="rounded-full"
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Salvar Alt Text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

