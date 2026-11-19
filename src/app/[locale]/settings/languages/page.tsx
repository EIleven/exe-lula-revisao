// src/app/[locale]/settings/languages/page.tsx
import { redirect } from 'next/navigation';

export default async function LanguageSettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/settings/accessibility`);
}
