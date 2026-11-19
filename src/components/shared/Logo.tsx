'use client';

import type { SVGProps } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';

const Logo = (_props: SVGProps<SVGSVGElement>) => {
  const locale = useLocale();
  return (
    <Link href={`/${locale}`} aria-label="HiperVerso Início">
      <div className="flex items-center gap-2.5 group">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30 font-black text-sm tracking-tight group-hover:bg-primary/20 transition-colors"
        >
          HV
        </span>
        <span
          className={cn(
            'text-xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors',
            'hidden md:inline',
          )}
        >
          HiperVerso
        </span>
      </div>
    </Link>
  );
};

export default Logo;
