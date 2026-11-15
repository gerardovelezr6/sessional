import { z } from 'zod';

// The school's website, as data: what the header shows, the menu, the blocks of the home page,
// announcements, and the administration page's name. Owners and advisors edit it at
// Settings → Website; nothing here is code.

const text = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max)).default({});
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
// A link: a page of this site ("/committees") or an address on the web (https only).
export const linkUrl = z
  .string()
  .max(500)
  .refine((v) => /^\/(?!\/)[^\s]*$/.test(v) || /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v), 'use a page of this site (/…) or an https:// address');

export const BLOCK_KINDS = ['banner', 'announcements', 'welcome', 'myCommittees', 'committees', 'text', 'links', 'placeholder'] as const;
export const blockSchema = z.object({
  key,
  kind: z.enum(BLOCK_KINDS),
  visible: z.boolean().default(true),
  // Heading and body: used by text, links, placeholder and (heading only) committees.
  title: text(120),
  body: text(2000),
  links: z.array(z.object({ label: text(60), url: linkUrl })).max(12).default([]),
});

export const NAV_ITEMS = ['home', 'dashboard', 'committees', 'people', 'grades', 'admin', 'owner', 'settings'] as const;
export const navItemSchema = z.object({
  key: z.enum(NAV_ITEMS),
  visible: z.boolean().default(true),
  // Empty: the product's own word, in each language.
  label: text(40),
});
export const customLinkSchema = z.object({ key, label: text(40), url: linkUrl });

export const TONES = ['info', 'urgent'] as const;
export const announcementSchema = z.object({
  key,
  message: text(300),
  tone: z.enum(TONES).default('info'),
  // Shown from and until (ISO dates and times); empty: always.
  startsAt: z.string().datetime({ offset: true }).nullable().default(null),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  // Where it appears.
  onHome: z.boolean().default(true),
  onConsole: z.boolean().default(true),
});

export const siteSchema = z
  .object({
    header: z.object({
      // The square beside the name when there is no logo: the school's initials, or nothing.
      mark: z.enum(['initials', 'none']).default('initials'),
      initials: z.string().max(4).default(''),
      tagline: z.boolean().default(true),
      userName: z.boolean().default(true),
    }),
    nav: z.array(navItemSchema).max(NAV_ITEMS.length),
    links: z.array(customLinkSchema).max(6).default([]),
    home: z.array(blockSchema).min(1).max(20),
    announcements: z.array(announcementSchema).max(20).default([]),
    admin: z.object({ title: text(60), subtitle: text(160) }),
  })
  .superRefine((v, ctx) => {
    const once = (list: { key: string }[], path: string) => {
      const seen = new Set<string>();
      list.forEach((x, i) => {
        if (seen.has(x.key)) ctx.addIssue({ code: 'custom', path: [path, i, 'key'], message: 'listed twice' });
        seen.add(x.key);
      });
    };
    once(v.nav, 'nav');
    once(v.links, 'links');
    once(v.home, 'home');
    once(v.announcements, 'announcements');
    v.announcements.forEach((a, i) => {
      if (a.startsAt && a.endsAt && Date.parse(a.endsAt) <= Date.parse(a.startsAt)) ctx.addIssue({ code: 'custom', path: ['announcements', i, 'endsAt'], message: 'ends before it starts' });
    });
  });

export type Site = z.infer<typeof siteSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type NavKey = (typeof NAV_ITEMS)[number];

// The parts of the website editor.
export const SITE_PARTS = ['home', 'menu', 'header', 'admin'] as const;
export type SitePart = (typeof SITE_PARTS)[number];
