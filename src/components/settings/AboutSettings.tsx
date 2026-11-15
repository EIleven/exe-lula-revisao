
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
import { Separator } from '@/components/ui/separator';
import { useTranslations, useLocale } from 'next-intl';
import PrivacyPreferencesButton from '@/components/consent/PrivacyPreferencesButton';

interface SettingsProps {
  user: User;
}

export default function AboutSettings({ user }: SettingsProps) {
  const t = useTranslations('AboutSettings');
  const tConsent = useTranslations('Consent');
  const locale = useLocale();
  const currentYear = new Date().getFullYear();

  return (
    <>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('aboutUs')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/about`}>{t('viewPage')}</Link>
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('privacyPolicy')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/privacy`}>{t('viewPage')}</Link>
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('termsOfService')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/terms`}>{t('viewPage')}</Link>
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('communityGuidelines')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/community-guidelines`}>{t('viewPage')}</Link>
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('cookiePolicy')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/cookies`}>{t('viewPage')}</Link>
          </Button>
        </div>
        {/* Canal do titular: protocolo, prazo e acompanhamento, ao lado dos documentos legais. */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{t('dataRights')}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/settings/data-rights`}>{t('open')}</Link>
          </Button>
        </div>
        {/* Caminho permanente para rever ou revogar o consentimento de cookies, no celular e no computador. */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <p className="font-medium">{tConsent('openPreferences')}</p>
          <PrivacyPreferencesButton variant="outline" label={tConsent('manage')} />
        </div>
        <Separator className="my-4" />
        <div className="text-center text-xs text-muted-foreground">
          <p>{t('version')}</p>
          <p>{t('copyright', { year: currentYear })}</p>
        </div>
      </CardContent>
    </>
  );
}
