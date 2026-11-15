// src/app/[locale]/help/page.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import BackButton from '@/components/shared/BackButton';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import ContactEmail from '@/components/shared/ContactEmail';
import { siteConfig } from '@/config/site';

export default function HelpCenterPage() {
  const t = useTranslations('HelpCenterPage');

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <BackButton />
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">{t('title')}</CardTitle>
          <CardDescription>
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8 text-foreground/90">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-primary">{t('faqTitle')}</h2>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>{t('q1')}</AccordionTrigger>
                <AccordionContent>
                  {t('a1')}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>{t('q2')}</AccordionTrigger>
                <AccordionContent>
                  {t('a2')}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>{t('q3')}</AccordionTrigger>
                <AccordionContent>
                  {t('a3')}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3 text-primary">{t('contactTitle')}</h2>
            <p>
              {siteConfig.contact.enabled ? (
                <>
                  {t('contactText')}{' '}
                  <ContactEmail channel="support" className="text-primary hover:underline" fallback={null} />.
                </>
              ) : (
                t('contactUnavailable')
              )}
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
