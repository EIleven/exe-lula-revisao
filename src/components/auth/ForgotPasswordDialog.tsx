// src/components/auth/ForgotPasswordDialog.tsx
'use client';

import { useEffect, useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { requestPasswordReset } from '@/lib/services/accountSecurity';

interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail?: string;
}

/** "Esqueceu a senha?": manda o link de nova senha, sem revelar se o e-mail tem conta. */
export default function ForgotPasswordDialog({ open, onOpenChange, initialEmail = '' }: ForgotPasswordDialogProps) {
  const [email, setEmail] = useState(initialEmail);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setSent(false);
      setError(null);
    }
  }, [open, initialEmail]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MailCheck className="h-5 w-5 text-primary" />
                Confira o seu e-mail
              </DialogTitle>
              <DialogDescription>
                Se existir uma conta com {email.trim()}, enviamos um link para criar uma senha nova. Ele vale por pouco
                tempo; procure também na pasta de spam.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Entendi</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Redefinir a senha</DialogTitle>
              <DialogDescription>Digite o e-mail da sua conta e enviaremos um link para criar uma senha nova.</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <Label htmlFor="reset-email">E-mail</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                autoFocus
                disabled={isSending}
                aria-invalid={!!error}
                aria-describedby={error ? 'reset-email-error' : undefined}
              />
              {error && <p id="reset-email-error" className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancelar</Button>
              <Button type="submit" disabled={isSending || !email.trim()}>
                {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
