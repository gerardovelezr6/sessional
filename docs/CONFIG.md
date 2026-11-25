# Settings

Every setting a school can change, generated from `src/config/registry.ts` and
`src/config/schema.ts`. Do not edit by hand: run `npm run config:doc`.

Each setting is saved as a draft, previewed, then published as a new version of its section;
every version is kept and can be restored. See `docs/ARCHITECTURE.md`, "Configuration".

## Identity (`identity`)

Spanish: Identidad

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Tagline | `identity.tagline` | (none) | text per language, up to 160 characters each | `tenant.manage` | A short line shown under your conference name on the sign-in page. |
| Dates | `identity.dates` | (none) | text per language, up to 120 characters each | `tenant.manage` | When the conference takes place, shown on the home page, for example "March 12–14, 2027". |
| Venue | `identity.venue` | (none) | text per language, up to 120 characters each | `tenant.manage` | Where it takes place, shown on the home page. |
| Time zone | `identity.timeZone` | `UTC` | an IANA time zone, e.g. `America/Mexico_City` | `tenant.manage` | Dates and times are shown in this time zone. |

## Language (`locale`)

Spanish: Idioma

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Languages | `locale.enabledLocales` | `["en","es"]` | language codes (BCP 47), e.g. `en, es, fr` | `tenant.manage` | English and Spanish are built in. For any other language, write the texts in the translation editor; until then they show in English. |
| Default language | `locale.defaultLocale` | `en` | one of the enabled languages | `tenant.manage` | The language of your conference’s pages. |

## Words (`terminology`)

Spanish: Palabras

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Set of words | `terminology.pack` | `un` | `un` (UN style (Chair, Delegate, High Command)), `secretariat` (Secretariat (President, Representative, Secretariat)), `school` (School (Moderator, Student, Organizers)), `reglamento` (Reglamento (Presidencia, Delegación, Secretaría General)) | `tenant.manage` | The words used for roles and structure across the product. Change any single word below. |
| Conference | `terminology.conference` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Committee (one) | `terminology.committee` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Committees (several) | `terminology.committees` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Chair (one) | `terminology.chair` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Chairs (several) | `terminology.chairs` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Delegate (one) | `terminology.delegate` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Delegates (several) | `terminology.delegates` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Organizing team | `terminology.highCommand` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Advisor (one) | `terminology.advisor` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Advisors (several) | `terminology.advisors` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |

## Committee types (`structure`)

Spanish: Tipos de comité

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Categories | `structure.categories` | (none) | edited on the committee types page | `tenant.manage` | Groups of committees, such as General Assembly or Security Council, each with a color. |
| Types | `structure.types` | `[{"key":"standard","name":{"en":"Standard","es":"Estándar"},"defaultCategory":null,"labelField":{"en":"Country","es":"País"},"flag":"country","groupLabel":{},"groups":[],"groupRequired":false,"confidentialTopic":false,"veto":false,"fields":[],"bulk":["label","name"]}]` | edited on the committee types page | `tenant.manage` | Kinds of committee: what the delegate list holds, where flags come from, and groups such as parties or sides. |

## Translations (`translations`)

Spanish: Traducciones

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Texts | `translations.messages` | (none) | edited in the translation editor; each text must keep the English placeholders | `tenant.manage` | Change any text of the product, in any of your languages, in the translation editor. |

## Design (`theme`)

Spanish: Diseño

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Design preset | `theme.preset` | `flat-institutional` | `sessional` (Sessional), `flat-institutional` (Classic conference), `classic-formal` (Classic formal), `modern-rounded` (Modern rounded), `high-contrast` (High contrast), `playful-school` (Playful school) | `theme.edit` | A complete look to start from. The settings below change parts of it. |
| Logo | `theme.logo` | as the preset has it | uploaded PNG, JPEG or WebP, up to 2 MB | `theme.edit` | PNG, JPEG or WebP, up to 2 MB. Shown in the page header and on the sign-in page. |
| Browser icon | `theme.favicon` | as the preset has it | uploaded square PNG, 32 to 1024 px | `theme.edit` | A square PNG, 32 to 1024 pixels, shown in the browser tab. It should still be clear at 16 pixels. |
| Brand color | `theme.brand` | as the preset has it | color as `#RRGGBB`; empty = as the preset has it | `theme.edit` | Your main color, used for buttons and highlights. Pick one, or keep the design’s. |
| Accent color | `theme.accent` | as the preset has it | color as `#RRGGBB`; empty = as the preset has it | `theme.edit` | A second color for small highlights. Pick one, or keep the design’s. |
| Page background | `theme.background` | as the preset has it | color as `#RRGGBB`; empty = as the preset has it | `theme.edit` | The color behind your pages. Very dark choices are lightened so text stays readable. |
| Font | `theme.font` | as the preset has it | `montserrat` (Montserrat), `inter` (Inter), `source-serif` (Source Serif), `nunito` (Nunito), `atkinson` (Atkinson Hyperlegible), `system` (Device font); empty = as the preset has it | `theme.edit` | The typeface of all text. |
| Corners | `theme.radius` | as the preset has it | `none` (Square), `small` (Slightly rounded), `medium` (Rounded), `large` (Very rounded); empty = as the preset has it | `theme.edit` | How rounded buttons, fields and cards are. |
| Spacing | `theme.density` | as the preset has it | `compact` (Compact), `comfortable` (Comfortable), `spacious` (Spacious); empty = as the preset has it | `theme.edit` | How much room controls and cards take. |
| Uppercase labels | `theme.uppercaseLabels` | as the preset has it | `on` (On), `off` (Off); empty = as the preset has it | `theme.edit` | Small labels in spaced capital letters. |
| Shadows | `theme.shadows` | as the preset has it | `on` (On), `off` (Off); empty = as the preset has it | `theme.edit` | A soft shadow under cards. |
| Contrast | `theme.contrast` | as the preset has it | `standard` (Standard), `high` (High); empty = as the preset has it | `theme.edit` | High contrast makes text and outlines stronger for easier reading. |
| Page header | `theme.headerStyle` | as the preset has it | `light` (Light), `brand` (In the brand color); empty = as the preset has it | `theme.edit` | The bar at the top of every page, with your logo or name. |
| Home page banner | `theme.homeBanner` | `on` | `on` (Show), `off` (Hide) | `theme.edit` | A band in your colors at the top of the home page, with the conference name, tagline, dates and venue. |
| Chair console | `theme.consoleLayout` | `tabs` | `tabs` (Tabs), `single` (One page) | `theme.edit` | One tab for each part of running a committee, or everything on one page. |
| Projection screens | `theme.screenStyle` | `dark` | `dark` (Dark), `light` (Light) | `theme.edit` | Screens in your colors on a dark background, easier to read on most projectors, or on a light one. |
| Page titles | `theme.pageTitle` | as the preset has it | `plain` (Plain), `bar` (With a colored bar); empty = as the preset has it | `theme.edit` | How the title at the top of each page is drawn. |
| Tabs | `theme.tabStyle` | as the preset has it | `underline` (Underlined), `pill` (Filled), `boxed` (Outlined); empty = as the preset has it | `theme.edit` | How the selected tab is marked. |
| Light or dark | `theme.colorMode` | `light` | `light` (Light), `dark` (Dark), `auto` (Automatic) | `theme.edit` | Automatic follows each person’s device setting. |
| Custom CSS (advanced) | `theme.customCss` | (empty) | CSS, up to 10000 characters, checked by the custom CSS rules | `theme.edit` | For small adjustments the options above do not cover. Allowed: the classes app-header, page-title, tabs, tab, card, card-footer, btn, btn-primary, btn-secondary, input, label, label-text; colors as #hex or var(--s-color-…); spacing, borders, corners, font size, weight and letter spacing. Not allowed: hiding or moving things, images, imports, !important. Text colors must stay readable. Use Preview my drafts to see it. If a change makes the page hard to use, open the settings in safe mode. |

## Rules of procedure (`protocol`)

Spanish: Reglas de procedimiento

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Starting point | `protocol.preset` | `un_style` | `un_style` (Standard UN-style), `harvard_style` (Harvard-style), `thimun_style` (THIMUN-style), `reglamento_es` (Spanish-language rules) | `tenant.manage` | The rules every committee follows. Changes apply from the next session that opens. |
| Your own rules | `protocol.pack` | as the preset has it | edited on the rules of procedure page; empty means the starting point as it is | `tenant.manage` | The starting point, changed where your conference does things differently. Empty means the starting point as it is. |

## Grading and awards (`grading`)

Spanish: Calificación y premios

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Grading rules | `grading.rules` | as the preset has it | edited on the grading page; empty means the standard rubric | `tenant.manage` | Empty means Sessional’s standard rubric. |

## Website (`site`)

Spanish: Sitio web

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Website | `site.page` | as the preset has it | edited on the website page; empty means the classic layout | `tenant.manage` | Empty means the classic layout. |

## People and sign-in (`people`)

Spanish: Personas e inicio de sesión

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Minimum password length | `people.passwordMinLength` | `8` | whole number, 8 to 128 | `tenant.manage` | The fewest characters a password may have (8 to 128). |
| Password must also have | `people.passwordRequire` | `length` | `length` (Nothing more), `letters_numbers` (Letters and numbers), `mixed` (Upper and lower case, a number and a symbol) | `tenant.manage` | Besides the minimum length. |
| Refuse common passwords | `people.passwordBlockCommon` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Also refuses passwords made of the person’s address or the school’s name. |
| Sign in with Google | `people.googleSignIn` | `off` | `on` (On), `off` (Off) | `tenant.manage` | Shows “Continue with Google” on the sign-in page. Only people you invited get in; Google must be set up in the authentication service. |
| Sign in with Microsoft | `people.microsoftSignIn` | `off` | `on` (On), `off` (Off) | `tenant.manage` | Shows “Continue with Microsoft” (school and work accounts). Only people you invited get in; Microsoft must be set up in the authentication service. |

## Announcements (`announcements`)

Spanish: Anuncios

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Announcements | `announcements.items` | as the preset has it | posted on the announcements page and published at once; empty means those of the website settings | `announcements.manage` | Posted on the announcements page and published at once. |

## Modules (`modules`)

Spanish: Módulos

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Grading and awards | `modules.grading` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Rubric, grades in the console and committee pages, the gradebook and awards. |
| Documents | `modules.documents` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Working papers, draft resolutions and amendments in each committee. |
| Projection screens | `modules.screens` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Screens paired to a committee, showing the speaker, timer and list. |
| Discipline | `modules.discipline` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Warnings and pardons in the chair console. |
| Announcements | `modules.announcements` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Notices on the home page, dashboard and console. |
| Schedule | `modules.schedule` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The conference schedule, shown on the home page, dashboard and console. |

## Public pages (`publicSite`)

Spanish: Páginas públicas

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Public pages | `publicSite.enabled` | `off` | `on` (On), `off` (Off) | `tenant.manage` | Off: the public address shows nothing. On: it shows the parts switched on below. |
| Delegations | `publicSite.delegations` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Each committee’s countries or roles, with flags. Never students’ names. |
| Schedule | `publicSite.schedule` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The conference schedule. |
| Passed resolutions | `publicSite.resolutions` | `on` | `on` (On), `off` (Off) | `tenant.manage` | Code and title of each resolution a committee passed. |
| Live view | `publicSite.live` | `off` | `on` (On), `off` (Off) | `tenant.manage` | What each committee’s projection screen shows (speaker, timer, list, last vote), on any phone. |

## Printing (`printing`)

Spanish: Impresión

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Paper size | `printing.paper` | `a4` | `a4` (A4), `letter` (Letter) | `tenant.manage` | A4 for most of the world, Letter for the United States, Canada and Mexico. |
| Placard style | `printing.placardStyle` | `classic` | `classic` (Classic), `bold` (Bold), `framed` (Framed), `minimal` (Minimal) | `tenant.manage` | Placards are folded in half; both faces show the delegation. |
| Placard color | `printing.placardColor` | as the preset has it | color as `#RRGGBB`; empty = as the preset has it | `tenant.manage` | Empty: the school’s main color. |
| Flag on placards | `printing.placardFlag` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The delegation’s flag, as in the app (country, US state or group logo). |
| Logo on placards | `printing.placardLogo` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The school’s logo in a corner of each face (PNG or JPEG logos). |
| Committee on placards | `printing.placardCommittee` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The committee’s name under the delegation. |
| Check-in code on placards | `printing.placardQr` | `on` | `on` (On), `off` (Off) | `tenant.manage` | A QR code a chair scans to mark the delegation present. |
| Certificate style | `printing.certificateStyle` | `classic` | `classic` (Classic), `modern` (Modern), `elegant` (Elegant), `minimal` (Minimal) | `tenant.manage` | Used for participation and award certificates. |
| Certificate color | `printing.certificateColor` | as the preset has it | color as `#RRGGBB`; empty = as the preset has it | `tenant.manage` | Empty: the school’s main color. |
| Flag on certificates | `printing.certificateFlag` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The flag of the delegation the student represented. |
| Logo on certificates | `printing.certificateLogo` | `on` | `on` (On), `off` (Off) | `tenant.manage` | The school’s logo at the top (PNG or JPEG logos). |
| Participation certificate title | `printing.certificateTitle` | (none) | text per language, up to 80 characters each | `tenant.manage` | Empty: “Certificate of Participation”. |
| Award certificate title | `printing.certificateAwardTitle` | (none) | text per language, up to 80 characters each | `tenant.manage` | Empty: “Certificate of Award”. |
| Line under the text | `printing.certificateNote` | (none) | text per language, up to 160 characters each | `tenant.manage` | For example the dates and place: “March 12–14, 2027 · City Hall”. Empty: the conference’s name. |
| First signature: name | `printing.signer1Name` | (none) | text per language, up to 80 characters each | `tenant.manage` | Who signs, printed under a signature line. Empty: no signature line. |
| First signature: role | `printing.signer1Role` | (none) | text per language, up to 80 characters each | `tenant.manage` | For example “Secretary-General”. |
| Second signature: name | `printing.signer2Name` | (none) | text per language, up to 80 characters each | `tenant.manage` | Empty: no second signature. |
| Second signature: role | `printing.signer2Role` | (none) | text per language, up to 80 characters each | `tenant.manage` | For example “Faculty advisor”. |
| Third signature: name | `printing.signer3Name` | (none) | text per language, up to 80 characters each | `tenant.manage` | Empty: no third signature. |
| Third signature: role | `printing.signer3Role` | (none) | text per language, up to 80 characters each | `tenant.manage` | For example “Head of school”. |

## Access code (`access`)

Spanish: Código de acceso

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Access code | `access.gate` | as the preset has it | edited on the access code page; stores only a hash of the code; empty means no code | `tenant.manage` | Only a hash of the code is stored. |
