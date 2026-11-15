// src/components/shared/BackButton.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { navigateBack } from '@/lib/backNavigation';

interface BackButtonProps {
    className?: string;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | null;
    text?: string;
    fallbackUrl?: string;
}

export default function BackButton({ className, variant = "ghost", text, fallbackUrl }: BackButtonProps) {
  const t = useTranslations('BackButton');
  const router = useRouter();
  const buttonText = text || t('back');

  return (
    <Button variant={variant} onClick={() => navigateBack(router, { fallbackUrl })} className={cn(className)}>
      <ArrowLeft className="mr-2 h-4 w-4" />
      {buttonText}
    </Button>
  );
}
