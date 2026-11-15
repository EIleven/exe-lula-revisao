// src/app/post/[postId]/BackButton.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { navigateBack } from '@/lib/backNavigation';

export default function BackButton() {
  const router = useRouter();

  return (
    <Button variant="ghost" onClick={() => navigateBack(router)} className="mb-4">
      <ArrowLeft className="mr-2 h-4 w-4" />
      Voltar
    </Button>
  );
}
