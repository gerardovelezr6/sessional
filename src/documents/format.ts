// A conference document as lists show it, and its size in words people read.
export interface ConferenceDocument {
  id: string;
  title: string;
  description: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  audience: 'staff' | 'members' | 'public';
  created_at: string;
}

export const sizeOf = (bytes: number, locale: string) =>
  bytes < 1024 * 1024
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
