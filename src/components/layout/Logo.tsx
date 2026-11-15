'use client';

import type { SVGProps } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';

const Logo = (props: SVGProps<SVGSVGElement>) => {
  const locale = useLocale();
  return (
    <Link href={`/${locale}`} aria-label="Exe. Lula Home">
    <div className="flex items-center gap-2 group">
      <Image
        src="/brand/lula-logo.svg"
        alt="Exe. Lula Logo"
        width={40}
        height={40}
        className="group-hover:opacity-80 transition-opacity"
      />
      <span className={cn(
        "text-2xl font-bold text-foreground group-hover:text-primary transition-colors",
        "hidden md:inline" // Hide text on mobile, show on medium screens and up
      )}>
        Exe. Lula
      </span>
    </div>
  </Link>
  );
};

export default Logo;
