// What changed, newest first, for the changelog page and "What's new" in the app. Written for the
// people who use Sessional, not for developers.

export interface Release {
  date: string; // YYYY-MM-DD
  title: { en: string; es: string };
  items: { en: string; es: string }[];
}

export const RELEASES: Release[] = [
  {
    date: '2026-11-25',
    title: { en: 'Sign up on your own', es: 'Regístrate por tu cuenta' },
    items: [
      { en: 'Start a 14-day trial from the website, with no card.', es: 'Empieza una prueba de 14 días desde el sitio web, sin tarjeta.' },
      { en: 'A setup wizard for the conference, its look and its rules.', es: 'Un asistente para preparar la conferencia, su imagen y su reglamento.' },
      { en: 'A demo conference to try everything on, ready to run.', es: 'Una conferencia de prueba lista para usar.' },
      { en: 'Short tours for Owners, organizers and chairs, and help on every main page.', es: 'Recorridos cortos para propietarios, organizadores y mesas, y ayuda en cada página principal.' },
      { en: 'Dates, times and numbers follow American and Mexican conventions; schedules use a 12-hour clock.', es: 'Fechas, horas y números siguen las convenciones de Estados Unidos y México; los horarios usan reloj de 12 horas.' },
    ],
  },
  {
    date: '2026-11-24',
    title: { en: 'Plans and billing', es: 'Planes y facturación' },
    items: [
      { en: 'Plans with clear limits, paid by card through Stripe, monthly, yearly or per conference.', es: 'Planes con límites claros, pagados con tarjeta mediante Stripe, al mes, al año o por conferencia.' },
      { en: 'A conference in progress is never cut off by a failed payment.', es: 'Una conferencia en curso nunca se corta por un pago fallido.' },
      { en: 'A new website with a contact form.', es: 'Un sitio web nuevo con formulario de contacto.' },
    ],
  },
  {
    date: '2026-11-22',
    title: { en: 'Support and safety tools', es: 'Herramientas de soporte y seguridad' },
    items: [
      { en: 'When our support team signs in to help, it needs a reason, shows a banner and appears in your audit log.', es: 'Cuando nuestro soporte entra para ayudar, necesita un motivo, muestra un aviso y aparece en tu registro.' },
      { en: 'Install themes, rules and rubrics from the Sessional library as drafts.', es: 'Instala temas, reglamentos y rúbricas de la biblioteca de Sessional como borradores.' },
    ],
  },
  {
    date: '2026-11-20',
    title: { en: 'Import, printing and public pages', es: 'Importación, impresión y páginas públicas' },
    items: [
      { en: 'Import every tab of a spreadsheet at once, with a list of problem rows and undo.', es: 'Importa todas las pestañas de una hoja de cálculo a la vez, con lista de filas con problemas y opción de deshacer.' },
      { en: 'Placards with flags and check-in codes, certificates, agendas and grade reports as PDFs.', es: 'Gafetes con banderas y códigos de registro, reconocimientos, agendas y boletas en PDF.' },
      { en: 'Public committee pages and QR check-in at the door.', es: 'Páginas públicas de comités y registro con QR en la entrada.' },
    ],
  },
];
