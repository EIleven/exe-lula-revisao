'use client';

import React from 'react';
import BackButton from '@/components/shared/BackButton';

interface PostPageHeaderProps {
    text: string;
}

export default function PostPageHeader({ text }: PostPageHeaderProps) {
    // Fica logo abaixo do cabeçalho quando ele aparece e no topo quando ele some: `.chrome-sticky` (globals.css), por CSS.
    // Antes esta página escutava a rolagem e guardava a posição em estado do React.
    return (
        <div className="chrome-sticky chrome-surface sticky z-20 border-b border-border px-4 py-2">
            <BackButton text={text} />
        </div>
    );
}
