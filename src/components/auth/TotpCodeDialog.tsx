// src/components/auth/TotpCodeDialog.tsx
'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
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
import { describeSecondFactorError } from '@/lib/services/accountSecurity';

interface TotpCodeDialogProps {
  open: boolean;
  /** Recebe o código; se lançar erro, a mensagem aparece no próprio diálogo. */
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
  description?: string;
}

/** Pede o código de 6 dígitos do app autenticador (entrar na conta ou confirmar a identidade). */
export default function TotpCodeDialog({ open, onSubmit, onCancel, description }: TotpCodeDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
    }
  }, [open]);

  const digits = code.replace(/\D/g, '');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (digits.length !== 6) {
      setError('O código tem 6 dígitos.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(digits);
    } catch (submitError) {
      setError(describeSecondFactorError(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isSubmitting) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Verificação em duas etapas
            </DialogTitle>
            <DialogDescription>
              {description ?? 'Abra o seu app autenticador e digite o código de 6 dígitos do Exe. Lula.'}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="totp-code">Código</Label>
            <Input
              id="totp-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              autoFocus
              className="text-center text-2xl tracking-[0.4em]"
              aria-invalid={!!error}
              aria-describedby={error ? 'totp-code-error' : undefined}
              disabled={isSubmitting}
            />
            {error && <p id="totp-code-error" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting || digits.length !== 6}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
