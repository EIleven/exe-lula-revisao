// src/components/auth/CompleteProfileDialog.tsx
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, XCircle, UserPlus } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { User } from '@/lib/types';
import { completeUserProfile } from '@/lib/services/userService';
import { adultBirthDateMax, isAdultBirthDate } from '@/lib/auth/birthDate';

type ValidationStatus = 'idle' | 'checking' | 'available' | 'taken';

const StatusIndicator = ({ status }: { status: ValidationStatus }) => {
  if (status === 'checking') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === 'available') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'taken') return <XCircle className="h-4 w-4 text-destructive" />;
  return null;
};

const checkAvailability = httpsCallable(functions, 'checkAvailability');

interface CompleteProfileDialogProps {
  user: User;
  onProfileComplete: (user: User) => void;
  onCancel: () => void;
}

export default function CompleteProfileDialog({ user, onProfileComplete, onCancel }: CompleteProfileDialogProps) {
  const [username, setUsername] = useState(user.username);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<ValidationStatus>('idle');
  const debouncedUsername = useDebounce(username, 500);
  const { toast } = useToast();

  useEffect(() => {
    if (debouncedUsername.length >= 3) {
      setUsernameStatus('checking');
      checkAvailability({ type: 'username', value: debouncedUsername })
        .then(result => {
          const isAvailable = (result.data as { available: boolean }).available;
          setUsernameStatus(isAvailable ? 'available' : 'taken');
        })
        .catch(error => {
            console.error("Error checking username:", error);
            setUsernameStatus('idle');
        });
    } else if (debouncedUsername.length > 0) {
      setUsernameStatus('idle');
    }
  }, [debouncedUsername]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameStatus !== 'available' || !isAdultBirthDate(dateOfBirth)) {
      toast({ title: 'Erro', description: 'Por favor, preencha todos os campos corretamente.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const updatedUser = await completeUserProfile(user.id, { username, dateOfBirth });
      if (updatedUser) {
        onProfileComplete(updatedUser);
      } else {
        throw new Error('Falha ao atualizar o perfil.');
      }
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message || 'Ocorreu um erro inesperado.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center">
              <UserPlus className="w-6 h-6 mr-2 text-primary" />
              Finalize seu Perfil
          </DialogTitle>
          <DialogDescription>
            Bem-vindo(a) ao Exe. Lula! Escolha seu nome de usuário e adicione sua data de nascimento para continuar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
            <div className="space-y-2">
                <Label htmlFor="username-complete">Nome de Usuário</Label>
                <div className="relative">
                    <Input
                    id="username-complete"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className={usernameStatus === 'taken' ? 'border-destructive focus-visible:ring-destructive' : (usernameStatus === 'available' ? 'border-green-500 focus-visible:ring-green-500' : '')}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                        <StatusIndicator status={usernameStatus} />
                    </div>
                </div>
                {usernameStatus === 'taken' && <p className="text-xs text-destructive">Nome de usuário já está em uso.</p>}
                {usernameStatus === 'available' && <p className="text-xs text-green-500">Nome de usuário disponível!</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="dob-complete">Data de Nascimento</Label>
                <Input
                    id="dob-complete"
                    type="date"
                    min="1900-01-01"
                    max={adultBirthDateMax()}
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                />
            </div>
            <DialogFooter>
                <Button type="submit" className="w-full" disabled={isLoading || usernameStatus !== 'available' || !dateOfBirth}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Salvar e Continuar
                </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
