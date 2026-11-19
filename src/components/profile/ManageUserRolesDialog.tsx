// src/components/profile/ManageUserRolesDialog.tsx
'use client';
import React, { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

interface ManageUserRolesDialogProps {
  user: User;
  onOpenChange: (open: boolean) => void;
  onUserUpdated: (user: Partial<User>) => void;
}

export default function ManageUserRolesDialog({ user, onOpenChange, onUserUpdated }: ManageUserRolesDialogProps) {
  const [isAdmin, setIsAdmin] = useState(user.isAdmin || false);
  const [isModerator, setIsModerator] = useState(user.isModerator || false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { firebaseUser } = useCurrentUser();

  useEffect(() => {
    setIsAdmin(Boolean(user.isAdmin));
    setIsModerator(Boolean(user.isModerator));
  }, [user.id, user.isAdmin, user.isModerator]);

  const hasChanges = isAdmin !== Boolean(user.isAdmin) || isModerator !== Boolean(user.isModerator);
  const isExternalAccount = user.id.startsWith('ap_') || user.id.startsWith('bsky_');

  const handleSave = async () => {
    if (!firebaseUser) {
      toast({ title: 'Sessão inválida', description: 'Faça login novamente.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetUserId: user.id,
          isAdmin,
          isModerator,
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; user?: Partial<User> } | null;
      if (!res.ok) {
        throw new Error(json?.error || 'Falha ao atualizar as funções do usuário.');
      }
      toast({ title: 'Funções Atualizadas', description: `As funções para @${user.username} foram salvas.` });
      onUserUpdated({ id: user.id, isAdmin, isModerator });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar as funções do usuário.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerenciar Funções para @{user.username}</DialogTitle>
          <DialogDescription>
            Atribua ou revogue privilégios administrativos e de moderação. As alterações entram em vigor imediatamente.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {isExternalAccount && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Contas externas federadas não podem receber cargos administrativos locais no HiperVerso.
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="admin-switch" className="text-base flex items-center"><ShieldCheck className="mr-2 h-4 w-4 text-destructive" /> Administrador</Label>
              <p className="text-sm text-muted-foreground">Concede acesso total a todos os painéis e recursos de administração.</p>
            </div>
            <Switch id="admin-switch" checked={isAdmin} onCheckedChange={setIsAdmin} disabled={isExternalAccount} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="moderator-switch" className="text-base flex items-center"><Shield className="mr-2 h-4 w-4 text-primary" /> Moderador</Label>
              <p className="text-sm text-muted-foreground">Concede acesso às ferramentas de moderação de conteúdo.</p>
            </div>
            <Switch id="moderator-switch" checked={isModerator} onCheckedChange={setIsModerator} disabled={isExternalAccount} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!hasChanges || isSubmitting || isExternalAccount}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar Alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
