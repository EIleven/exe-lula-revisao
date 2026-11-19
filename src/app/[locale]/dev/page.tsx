import React from 'react';
import BackButton from '@/components/shared/BackButton';
import { DevAccessPortal } from '@/components/dev/DevAccessPortal';

export default function DevPage() {
  return (
    <div className="container mx-auto max-w-3xl py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <BackButton />
      </div>
      <DevAccessPortal />
    </div>
  );
}

