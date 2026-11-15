
'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from 'next-intl';

interface LoginOrRegisterPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionName?: string;
  currentPath?: string;
}

export default function LoginOrRegisterPromptDialog({
  open,
  onOpenChange,
  actionName = "interagir",
  currentPath = "/",
}: LoginOrRegisterPromptDialogProps) {
  const router = useRouter();
  const locale = useLocale();

  const handleLogin = () => {
    onOpenChange(false);
    router.push(`/${locale}/login?redirect=${encodeURIComponent(currentPath)}`);
  };

  const handleRegister = () => {
    onOpenChange(false);
    router.push(`/${locale}/register?redirect=${encodeURIComponent(currentPath)}`);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Participe da Conversa!</AlertDialogTitle>
          <AlertDialogDescription>
            Você precisa estar logado para {actionName}. Por favor, faça login ou registre-se para continuar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          </AlertDialogCancel>
          <div className="flex flex-col sm:flex-row gap-2 mt-2 sm:mt-0">
            <Button onClick={handleRegister} className="w-full sm:w-auto">Registrar</Button>
            <Button onClick={handleLogin} className="w-full sm:w-auto">Entrar</Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
