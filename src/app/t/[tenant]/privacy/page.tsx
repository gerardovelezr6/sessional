import { SchoolLegal } from '@/site/SchoolLegal';

export default async function Page({ params }: { params: Promise<{ tenant: string }> }) {
  return <SchoolLegal tenantKey={(await params).tenant} kind="privacy" />;
}
