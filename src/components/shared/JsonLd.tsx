// src/components/shared/JsonLd.tsx
import React from 'react';
import { Thing, WithContext } from 'schema-dts';
import { safeJsonForScript } from '@/lib/security/sanitizeHtml';

interface JsonLdProps<T extends Thing> {
  data: WithContext<T>;
}

export default function JsonLd<T extends Thing>({ data }: JsonLdProps<T>) {
  return (
    <script
      type="application/ld+json"
      // Título e texto de posts entram aqui: um "</script>" neles fechava a tag e o resto virava HTML.
      dangerouslySetInnerHTML={{ __html: safeJsonForScript(data) }}
    />
  );
}
