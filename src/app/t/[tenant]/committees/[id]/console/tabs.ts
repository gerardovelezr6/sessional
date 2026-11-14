// The chair console's tabs, in order. Shared by the page (which reads ?tab=) and the console.
export type ConsoleTab = 'roll' | 'floor' | 'motions' | 'voting' | 'discipline';
export const CONSOLE_TABS: ConsoleTab[] = ['roll', 'floor', 'motions', 'voting', 'discipline'];
