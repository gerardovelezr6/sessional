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
| Time zone | `identity.timeZone` | `UTC` | an IANA time zone, e.g. `America/Mexico_City` | `tenant.manage` | Dates and times are shown in this time zone. |

## Language (`locale`)

Spanish: Idioma

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Languages | `locale.enabledLocales` | `["en","es"]` | language codes (BCP 47), e.g. `en, es, fr` | `tenant.manage` | English and Spanish are built in. For any other language, write the texts in the translation editor; until then they show in English. |
| Default language | `locale.defaultLocale` | `en` | one of the enabled languages | `tenant.manage` | The language of your conference's pages. |

## Words (`terminology`)

Spanish: Palabras

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Set of words | `terminology.pack` | `un` | `un` (UN style (Chair, Delegate, High Command)), `secretariat` (Secretariat (President, Representative, Secretariat)), `school` (School (Moderator, Student, Organisers)), `reglamento` (Reglamento (Presidencia, Delegación, Secretaría General)) | `tenant.manage` | The words used for roles and structure across the product. Change any single word below. |
| Conference | `terminology.conference` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Committee (one) | `terminology.committee` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Committees (several) | `terminology.committees` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Chair (one) | `terminology.chair` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Chairs (several) | `terminology.chairs` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Delegate (one) | `terminology.delegate` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Delegates (several) | `terminology.delegates` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Organising team | `terminology.highCommand` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Advisor (one) | `terminology.advisor` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |
| Advisors (several) | `terminology.advisors` | (none) | text per language, up to 60 characters each | `tenant.manage` | Leave empty to use the word from the set above. Write it for each of your languages. |

## Committee types (`structure`)

Spanish: Tipos de comité

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Categories | `structure.categories` | (none) | edited on the committee types page | `tenant.manage` | Groups of committees, such as General Assembly or Security Council, each with a colour. |
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
| Design preset | `theme.preset` | `sessional` | `sessional` (Sessional), `flat-institutional` (Flat institutional), `classic-formal` (Classic formal), `modern-rounded` (Modern rounded), `high-contrast` (High contrast), `playful-school` (Playful school) | `theme.edit` | A complete look to start from. The settings below change parts of it. |
| Logo | `theme.logo` | as the preset has it | uploaded PNG, JPEG or WebP, up to 2 MB | `theme.edit` | PNG, JPEG or WebP, up to 2 MB. Shown in the page header and on the sign-in page. |
| Browser icon | `theme.favicon` | as the preset has it | uploaded square PNG, 32 to 1024 px | `theme.edit` | A square PNG, 32 to 1024 pixels, shown in the browser tab. It should still be clear at 16 pixels. |
| Brand colour | `theme.brand` | as the preset has it | colour as `#RRGGBB`; empty = as the preset has it | `theme.edit` | Your main colour, used for buttons and highlights. Pick one, or keep the design's. |
| Accent colour | `theme.accent` | as the preset has it | colour as `#RRGGBB`; empty = as the preset has it | `theme.edit` | A second colour for small highlights. Pick one, or keep the design's. |
| Page background | `theme.background` | as the preset has it | colour as `#RRGGBB`; empty = as the preset has it | `theme.edit` | The colour behind your pages. Very dark choices are lightened so text stays readable. |
| Font | `theme.font` | as the preset has it | `montserrat` (Montserrat), `inter` (Inter), `source-serif` (Source Serif), `nunito` (Nunito), `atkinson` (Atkinson Hyperlegible), `system` (Device font); empty = as the preset has it | `theme.edit` | The typeface of all text. |
| Corners | `theme.radius` | as the preset has it | `none` (Square), `small` (Slightly rounded), `medium` (Rounded), `large` (Very rounded); empty = as the preset has it | `theme.edit` | How rounded buttons, fields and cards are. |
| Spacing | `theme.density` | as the preset has it | `compact` (Compact), `comfortable` (Comfortable), `spacious` (Spacious); empty = as the preset has it | `theme.edit` | How much room controls and cards take. |
| Uppercase labels | `theme.uppercaseLabels` | as the preset has it | `on` (On), `off` (Off); empty = as the preset has it | `theme.edit` | Small labels in spaced capital letters. |
| Shadows | `theme.shadows` | as the preset has it | `on` (On), `off` (Off); empty = as the preset has it | `theme.edit` | A soft shadow under cards. |
| Contrast | `theme.contrast` | as the preset has it | `standard` (Standard), `high` (High); empty = as the preset has it | `theme.edit` | High contrast makes text and outlines stronger for easier reading. |
| Page header | `theme.headerStyle` | as the preset has it | `light` (Light), `brand` (In the brand colour); empty = as the preset has it | `theme.edit` | The bar at the top of every page, with your logo or name. |
| Page titles | `theme.pageTitle` | as the preset has it | `plain` (Plain), `bar` (With a coloured bar); empty = as the preset has it | `theme.edit` | How the title at the top of each page is drawn. |
| Tabs | `theme.tabStyle` | as the preset has it | `underline` (Underlined), `pill` (Filled), `boxed` (Outlined); empty = as the preset has it | `theme.edit` | How the selected tab is marked. |
| Light or dark | `theme.colorMode` | `light` | `light` (Light), `dark` (Dark), `auto` (Automatic) | `theme.edit` | Automatic follows each person's device setting. |
| Custom CSS (advanced) | `theme.customCss` | (empty) | CSS, up to 10000 characters, checked by the custom CSS rules | `theme.edit` | For small adjustments the options above do not cover. Allowed: the classes app-header, page-title, tabs, tab, card, card-footer, btn, btn-primary, btn-secondary, input, label, label-text; colours as #hex or var(--s-color-…); spacing, borders, corners, font size, weight and letter spacing. Not allowed: hiding or moving things, images, imports, !important. Text colours must stay readable. Use Preview my drafts to see it. If a change makes the page hard to use, open the settings in safe mode. |

## Rules of procedure (`protocol`)

Spanish: Reglas de procedimiento

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Starting point | `protocol.preset` | `un_style` | `un_style` (Standard UN-style), `harvard_style` (Harvard-style), `thimun_style` (THIMUN-style), `reglamento_es` (Spanish-language rules) | `tenant.manage` | The rules every committee follows. Changes apply from the next session that opens. |
| Your own rules | `protocol.pack` | as the preset has it | edited on the rules of procedure page; empty means the starting point as it is | `tenant.manage` | The starting point, changed where your conference does things differently. Empty means the starting point as it is. |

## People and sign-in (`people`)

Spanish: Personas e inicio de sesión

| Setting | Key | Default | Allowed | Who can change | What it does |
|---|---|---|---|---|---|
| Minimum password length | `people.passwordMinLength` | `8` | whole number, 8 to 128 | `tenant.manage` | The fewest characters a password may have (8 to 128). |
