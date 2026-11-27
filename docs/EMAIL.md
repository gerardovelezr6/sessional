# Email design

How Sessional's emails look, who they come from, and what they may contain. The website's design
language is in `docs/DESIGN.md`; this applies it to email, where much of the web is not available
(no web fonts, no stylesheets, images often blocked until the reader allows them).

## Two kinds of email

| Kind | Examples | Look | Sender | Replies go to |
|---|---|---|---|---|
| **Sessional's own** | Sign-up link ("Create {school} on Sessional") | Session tiles, header banner | `CONTACT_FROM_EMAIL` (the onboarding sender) | that sender |
| **Sessional support** | Confirmation after writing through `/support` | Session tiles, header banner | `Sessional Support <support@sessional.app>` (`SUPPORT_EMAIL`) | `support@sessional.app` |
| **A school's** | Invitation, password reset, "you were added" | The school's theme and logo (white-label) | The school's verified domain, else Sessional on its behalf | The school's reply-to address |
| **Internal notices** | A contact or support request, to us | Plain text | the onboarding sender | the person who wrote |

Support answers always come from `support@sessional.app`, never from the address that sends sign-up
links and invitations, so a school can tell an automatic email from a person helping them.

A school's emails never carry the Sessional banner: they are the school's. Sessional appears there
only as "Powered by Sessional" under the preview in Settings.

## Anatomy

```
┌──────────────────────────────── 560 ────────────────────────────────┐
│ [ banner: sessional wordmark on white, 560 × 112 ]                  │  1px rule border
├──────────────────────────────────────────────────────────────────────┤
│ Heading (20px, bold, ink)                                            │
│ Paragraphs (16px, line height 1.6, ink)                              │  24px padding
│ [ Button ]  magenta, white text, square corners, 12 × 20 padding     │
└──────────────────────────────────────────────────────────────────────┘
  Footer (12px, graphite): "Sessional · Model UN conferences for schools · sessional.app"
```

- One column, at most 560px wide, centred, on white. It reads the same on a phone: the banner
  scales down with the width.
- Built with tables and inline styles (`src/theme/email.ts`), because email programs ignore
  stylesheets and CSS variables. Every value is resolved from the `sessional` theme preset, so the
  email changes when the palette does.
- Always the light palette. Email programs apply their own dark mode; the banner is drawn on white
  so it stays legible when they do.

## The banner

- File: `public/email/sessional-header.png` (1200 × 240, the 2x export of
  `brand/kit/sessional-email-header@2x.png`), shown at 560 wide.
- Linked from the site (`https://sessional.app/email/sessional-header.png`), not attached: every
  email program can load a linked image, attachments are treated as files by some.
- Alt text "Sessional", styled as bold 20px ink text, so with images off the email still opens on
  the name.
- Nothing in the banner is needed to understand the email: the heading says what it is about.

## Type and colour

| Part | Value |
|---|---|
| Text | The theme's sans stack, which falls back to the reader's system sans (web fonts don't load in email) |
| Heading | 20px, bold, ink `#111111` |
| Body | 16px, line height 1.6, ink |
| Button | Magenta `#C8175D`, white text (5.6:1), bold, square corners, 12px × 20px |
| Footer | 12px, graphite `#4B5058` |
| Frame | 1px rule `#E3E5E8` |

## Content rules

- Every email has a plain-text part with the same words and the link written out.
- One action per email, as a button whose label says what happens ("Create Colegio Norte"); the
  link is also in the plain-text part.
- In the reader's language (English or Mexican Spanish), never labelled by dialect.
- No tracking pixels, no link tracking, no remote fonts.
- No personal information about students. Support confirmations remind people not to send any.
- Subjects say what the email is about in a few words, without the product name doing the work.

## Where it lives

- `src/theme/email.ts`: the renderer (school emails, and the banner variant).
- `src/platform/brand-email.ts`: Sessional's own emails (`brandEmailHtml`), the support address
  and sender.
- `src/platform/support.ts`: the support confirmation (`sendSupportAck`).
- `src/app/signup/actions.ts`: the sign-up email.
- `src/platform/school-mail.ts`: a school's emails.
- Tests: `tests/e2e/support-page.spec.ts` (sender, reply-to, banner), `tests/e2e/onboarding.spec.ts`
  (banner and button in the sign-up email), `tests/e2e/whitelabel.spec.ts` (school emails).

## Before going live

- Verify `sessional.app` in Resend, then set `CONTACT_FROM_EMAIL` (for example
  `onboarding@sessional.app`) and `SUPPORT_EMAIL` (`support@sessional.app`).
- Give `support@sessional.app` a real inbox or forwarding, so replies to confirmations arrive, and
  answer support requests from it.
