import { Notice } from '@/components/Notice';
import { DEFAULT_LOCALE, translator } from '@/messages';

export default function NotFound() {
  const t = translator(DEFAULT_LOCALE);
  return <Notice title={t('notFound.title')} body={t('notFound.body')} />;
}
