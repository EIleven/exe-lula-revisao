// src/components/settings/HelpSettings.tsx
'use client';

import React from 'react';
import type { User } from '@/lib/types';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { siteConfig } from '@/config/site';

interface SettingsProps {
  user: User;
}

export default function HelpSettings({ user }: SettingsProps) {
  const t = useTranslations('HelpSettings');
  const locale = useLocale();
  return (
    <>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('faq')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/help`}>{t('viewPage')}</Link>
          </Button>
        </div>
         <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('contact')}</p>
          {siteConfig.contact.enabled ? (
            <Button asChild variant="outline" size="sm">
              <a href={`mailto:${siteConfig.contact.support}`}>{t('sendEmail')}</a>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">{t('contactSoon')}</span>
          )}
        </div>
      </CardContent>
    </>
  );
}
