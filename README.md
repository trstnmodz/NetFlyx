# NetFlx — your own streaming library

NetFlx is a personal streaming app for media you already own. An administrator pastes a
Dropbox share link, and the file becomes a browsable, playable title: poster, synopsis,
category, subtitle tracks, episode order, resume point. Viewers watch it on a phone,
laptop, or an Android TV, download it for offline play, and hand a title from their phone
to the TV with a pairing code.

It is built as a React + Vite single-page app on the Base44 platform (hosted auth,
database, backend functions, hosting) and streams video directly from Dropbox.

## Who uses it

- **Viewers** — anyone the library is shared with. They browse and play, and signed-in
  viewers additionally keep their place, save titles, and ask for new content.
- **The library owner / administrator** — the person who curates the catalogue: adds
  titles, groups series into ordered episodes, attaches subtitles, reviews requests, and
  decides who else may administer the app.

## Roles and what each can do

| Role | How it is granted | What it can do |
| --- | --- | --- |
| Guest (not signed in) | — | Browse Home, Search and Library; open a title page and stream it; read Help, Status, Legal and the policy pages. Cannot save progress, use My List, request titles, or download. |
| Viewer | Signs up / signs in (email + password or Google) | Everything a guest can do, plus: resume playback across devices, My List, playback History, offline Downloads, title Requests and their review status, playback and download settings. |
| Administrator | App role `role: "admin"`, **or** their email is listed as active in the `AdminMember` allowlist | Everything a viewer can do, plus the `/admin` console: add / edit / delete titles, bulk import, manage subtitles, review title requests, list users, read the activity log, and manage the admin allowlist. Also sees Edit / Remove controls on title pages. |

Admin rights are checked server-side on every admin call (`adminApi`), not just hidden in
the UI: a non-administrator calling an admin action gets `403` and the attempt is written
to the activity log as a denied action.

## Pages and routes

Public / viewer pages, inside the shared app shell (top header on phones, left rail on
desktop and TV, bottom navigation on phones):

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | Home | Featured hero, Continue watching, My list, "Because you watched…", and a row per category. Offline and empty-library states. On a TV it also listens for a paired phone. |
| `/search` | Search | Text search plus category filter over the library. |
| `/library` | Library | Full catalogue grid with category filters; admin-only Add / Import actions. |
| `/title/:id` | Title detail | Poster, metadata, synopsis, progress, Play/Resume, Download, My List toggle, subtitle choice, episode list, Up next, admin Edit / Remove. |
| `/watch/:id` | Watch | The player: subtitles, speed, Skip intro, resume, offline source fallback, Up next column, next-episode countdown, More like this. |
| `/mylist` | My List | Titles the viewer saved. |
| `/suggestions` | Requests | Ask for a title and follow the status of earlier requests. |
| `/history` | History | Recently watched titles with progress. |
| `/downloads` | Downloads | Saved-for-offline titles, storage usage, download controls, offline messaging. |
| `/help` | Help | How playback, subtitles, downloads and TV pairing work; FAQ. |
| `/status` | Status | Live service health checks (library, playback, subtitles, pairing). |
| `/pair`, `/pair/:code` | Pair | Phone side of the phone→TV handoff (code entry / QR deep link). |
| `/settings` | Settings | Playback preferences, subtitle appearance, download behaviour, TV mode, profiles. |
| `/add`, `/edit/:id` | Add / Edit title | Admin-gated title form: metadata, Dropbox video link, series grouping, intro timings. |
| `/import` | Bulk import | Admin-gated paste-a-list importer with preview and result summary. |
| `/admin` | Admin overview | Counts, quick actions, recent activity. |
| `/admin/movies`, `/admin/series`, `/admin/episodes` | Admin lists | Browse, search, feature, delete titles by kind; episode ordering per series. |
| `/admin/subtitles` | Admin subtitles | All subtitle tracks, with delete. |
| `/admin/suggestions` | Admin requests | Review queue: approve or reject a request with a note. |
| `/admin/users` | Admin users | Registered app users and their roles. |
| `/admin/logs` | Admin activity | Audit trail of admin actions and denied attempts. |
| `/admin/access` | Admin access | Manage the `AdminMember` allowlist (add, deactivate, remove). |

Account and policy pages, outside the shell:

| Route | Purpose |
| --- | --- |
| `/login` | Email + password sign-in (with MFA step) and "Continue with Google". |
| `/register` | Sign up, OTP verification, resend code, Google sign-up. |
| `/forgot-password` | Request a reset email (always shows a generic confirmation). |
| `/reset-password` | Set a new password from the emailed `?token=`. |
| `/thank-you` | Post-signup confirmation. |
| `/privacy`, `/terms` | Privacy policy and terms of use. |
| `/legal` | Legal hub. |
| `/legal/copyright` | Copyright / takedown policy. |
| `/legal/community` | Community guidelines. |
| `*` | Not-found page (also emits a real 404 for crawlers). |

`src/pages/Mfa.jsx` and `src/pages/OAuthConsent.jsx` are platform-shaped screens that are
present but not routed: MFA setup and challenge are handled inline by the login and
register flows.

## Data model

All records live in the Base44 database. Every record also carries `id`, `created_date`,
`updated_date` and `created_by_id`. Row-level security is declared per table in
`base44/entities/*.jsonc`.

### `Title` — the catalogue

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | **required** — movie title or episode name |
| `description` | string | short synopsis |
| `category` | enum | `Movies`, `Series`, `Documentaries`, `Animation`, `Uncategorized`, `Other` |
| `poster_url` | string | portrait artwork |
| `backdrop_url` | string | wide artwork for hero and landscape cards |
| `dropbox_link` | string | the share link exactly as pasted |
| `video_url` | string | converted direct playback URL |
| `series_name`, `season`, `episode` | string / number / number | groups an episode into a series |
| `year`, `runtime` | number | release year, runtime in minutes |
| `intro_start`, `intro_end` | number | seconds; drive Skip intro |
| `featured` | boolean | show in the hero banner |
| `last_position`, `last_duration`, `last_watched` | number / number / string | legacy, unused — per-viewer progress lives in `WatchProgress` |

Readable by anyone; create / update / delete only by administrators.

### `Subtitle` — subtitle tracks per title

| Field | Type | Notes |
| --- | --- | --- |
| `title_id` | string | **required** — owning title or episode |
| `label` | string | name shown in the player, e.g. English |
| `language` | string | two-letter code, e.g. `en` |
| `dropbox_link` | string | share link as pasted |
| `url` | string | **required** — converted direct URL for the subtitle file |
| `format` | enum | `srt` or `vtt` |
| `is_default` | boolean | auto-select on playback |

Publicly readable; written by administrators only.

### `WatchProgress` — one record per viewer per title

| Field | Type | Notes |
| --- | --- | --- |
| `title_id` | string | **required** |
| `position` | number | last position in seconds |
| `duration` | number | video duration in seconds |
| `watched_at` | string | ISO timestamp of the last playback |

Private to its owner (RLS on `created_by_id`).

### `MyListItem` — a saved title

| Field | Type | Notes |
| --- | --- | --- |
| `title_id` | string | **required** — the saved title |
| `profile_id` | string | local profile that saved it |

Private to its owner.

### `TitleSuggestion` — a viewer's request and the review decision

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | **required** — requested title |
| `kind` | enum | `Movie` or `Series` |
| `details` | string | identifying detail or reason from the requester |
| `status` | enum | `pending`, `approved`, `rejected` |
| `decision_note` | string | reviewer's reply, shown back to the requester |
| `reviewed_by`, `reviewed_at` | string, string | who decided, and when |

Viewers read and create only their own requests; only administrators may update or delete.

### `TvSession` — short-lived phone→TV pairing state

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | **required** — six-character code shown on the TV |
| `host_secret` | string | **required** — secret only the TV holds |
| `status` | enum | `waiting`, `paired`, `playing` |
| `controller_id`, `controller_name` | string, string | the paired phone |
| `title_id`, `title_name` | string, string | what the phone asked the TV to play |
| `expires_at` | string | ISO timestamp after which the session is dead |

Read and written only through the `tvPair` backend function (service role); direct client
access is restricted to administrators.

### `AdminMember` — the admin allowlist

| Field | Type | Notes |
| --- | --- | --- |
| `email` | string | **required** — authorized address |
| `active` | boolean | set `false` to revoke access without losing history |
| `note` | string | optional note about this administrator |
| `added_by` | string | email of whoever granted access |

Administrators only.

### `AdminLog` — audit trail

| Field | Type | Notes |
| --- | --- | --- |
| `action` | string | **required** — machine key, e.g. `title.delete`, `admin.denied` |
| `actor_email`, `actor_id` | string, string | who performed it |
| `entity`, `record_id` | string, string | what was touched |
| `summary` | string | human-readable description |
| `outcome` | enum | `success`, `denied`, `error` |

Administrators only.

### `User` — built-in platform table

The platform owns it (`id`, `created_date`, `full_name`, `email`, `role`). `role` is
`admin` or `user`; records are created by sign-up or invite, never by app code.

### Backend functions (`base44/functions/`)

| Function | Purpose |
| --- | --- |
| `adminApi` | The only privileged endpoint: `whoami`, admin allowlist CRUD, activity log, user list, title request review, bulk title delete, feature toggle, subtitle delete. Verifies the caller is an administrator server-side on every action. |
| `dropboxLink` | Converts a pasted Dropbox share link into a direct, streamable URL; validates that the target is a Dropbox file link. |
| `subtitleVtt` | Fetches an SRT/VTT subtitle file and converts it to WebVTT for the `<track>` element. |
| `serviceStatus` | Health checks behind the public Status page. |
| `tvPair` | Creates, reads and closes phone→TV pairing sessions by code, using the TV's host secret. |

Shared server logic lives in `base44/shared/` (`dropboxLink.ts` for link normalisation,
`subtitleFormat.ts` for SRT→WebVTT cue timing).

## Third-party services

| Concern | Service | Notes |
| --- | --- | --- |
| Auth | Base44 hosted auth | Email + password with OTP verification and password reset, Google OAuth (`loginWithMfa`, `loginWithGoogle`), optional MFA challenge/setup. No custom auth backend. |
| Database, functions, hosting | Base44 platform | Entities, backend functions, file storage, publishing. |
| Media hosting / delivery | Dropbox | Video and subtitle files stay in the owner's Dropbox; share links are converted to direct URLs at add time. |
| Payments | None | The app takes no payments. (`@stripe/*` packages are present in `package.json` from the platform template but no checkout code uses them.) |
| Email | None from app code | Sign-in, verification and password-reset mail is sent by the Base44 platform, not by the app. |
| AI | None | No LLM or image/video generation is used at runtime. |

## Design system

**Mood.** Cinematic and dark — a red-on-black theatre. Content imagery leads; chrome
recedes into near-black surfaces with a single crimson accent for the active and primary
actions.

**Fonts** (declared in `src/index.css`, mapped in `tailwind.config.js`):

- `--font-heading`, `--font-body`, `--font-display` — **Inter**, with `ui-sans-serif` /
  `system-ui` fallbacks.
- `--font-mono` — **JetBrains Mono** for metadata: eyebrows, categories, timestamps,
  progress labels, set uppercase with wide tracking.

**Palette** (HSL channel tokens in `src/index.css`, used as `hsl(var(--token))`; both
`:root` and `.dark` are defined, `.dark` only overriding background and foreground):

| Token | Value | Approx. hex | Use |
| --- | --- | --- | --- |
| `--background` | `0 0% 5%` | `#0D0D0D` | app background |
| `--foreground` | `0 0% 100%` | `#FFFFFF` | body text |
| `--primary` / `--ion` / `--ring` | `357 92% 47%` | `#E60A15` | accent, primary buttons, active nav, focus rings |
| `--primary-foreground` | `0 0% 100%` | `#FFFFFF` | text on accent |
| `--card`, `--surface` | `0 0% 10%` | `#1A1A1A` | cards, panels |
| `--popover` | `0 0% 8%` | `#141414` | menus, sheets |
| `--secondary`, `--muted`, `--accent` | `0 0% 14%`–`0 0% 16%` | `#242424`–`#2A2A2A` | quiet surfaces, hovers |
| `--muted-foreground` | `0 0% 65%` | `#A6A6A6` | secondary text |
| `--border`, `--input` | `0 0% 17%`, `0 0% 19%` | `#2B2B2B`, `#303030` | hairlines, fields |
| `--destructive` | `357 85% 42%` | `#C60F18` | remove / error |
| `--navy` | `357 60% 14%` | `#390E10` | tinted icon wells on empty states |
| `--chart-1…5` | reds → orange → gray | — | reserved for charts |

Radii: `--radius: 0.75rem` (12px) for the shell, cards and dialogs. The watch page keeps
its own flatter scale — 4px corners and squared surfaces (`--w-surface`, `--w-raised`,
`--w-line`, `--w-success` in the `.watch-page` scope).

**Layout widths**

- Shared shell: fixed left rail **92px** on `md` and up (brand mark 68px wide, icon-over-
  label items), content column `max-w-[1600px]` with `md:pl-[124px]` and `md:pr-8`.
- Phones: sticky top header (brand + icon actions), bottom navigation bar with five items
  and `env(safe-area-inset-bottom)` padding; page content sits above it (`pb-28`).
- Player route (`/watch/*`) renders without the shell chrome.
- Admin console: its own fixed sidebar **240px** (`w-60`), content column `max-w-6xl`
  (1152px) with `px-4 sm:px-6`; on phones the sidebar becomes a horizontal scrolling tab
  bar.
- TV: `html.tv-mode` raises the root font size to 19px and enlarges focus rings for
  couch viewing.

**Breakpoints** — Tailwind defaults, unchanged in `tailwind.config.js`: `sm` 640px,
`md` 768px (shell switches from phone to rail/bottom-nav-off here), `lg` 1024px (watch
page becomes a two-column player + rail layout), `xl` 1280px, `2xl` 1536px.

**Motion** — tokens in `src/index.css`: `--dur-press` 100ms, `--dur-focus` 140ms,
`--dur-base` 200ms, `--dur-slide` 280ms, `--dur-screen` 340ms, `--stagger` 50ms, with
`--ease-standard` / `--ease-exit` curves. Utilities: `.pressable`, `.card-motion`,
`.focus-lift`, `.screen-enter`, `.rise-in` (+ `stage-1…4` delays), `.pulse-once`. All of
them collapse under `prefers-reduced-motion: reduce`.

## Project structure

```
index.html                 page shell, SEO tags, favicon, fonts
src/
  main.jsx                 entry point
  App.jsx                  router, auth + query providers, shells
  index.css                design tokens, motion utilities, watch-page styles
  api/base44Client.js      pre-initialised Base44 SDK client
  components/              shell, player, cards, admin console, downloads, subtitles,
                           TV pairing, suggestions, legal, shadcn/ui primitives
  pages/                   one file per route (plus pages/admin, pages/legal)
  lib/                     SDK-facing helpers: library queries, progress, downloads
                           and offline store, subtitles, preferences, TV nav, pairing,
                           profiles, SEO, admin API wrapper, auth/MFA helpers
  hooks/                   small reusable hooks
  utils/                   URL helpers
public/                    manifest, service worker, offline player, robots, sitemap
base44/
  entities/*.jsonc         data model + row-level security
  functions/<name>/entry.ts backend functions (Deno)
  shared/                  logic used by more than one function
  config.jsonc             install / build / serve commands
AGENTS.md, CLAUDE.md       notes for AI coding agents working in this repo
```

## Environment variables

The frontend reads only Base44-provided values. Copy `.env.example` to `.env.local` and
leave the values to the platform (or fill them in when running the frontend against a
hosted backend):

| Name | Purpose |
| --- | --- |
| `VITE_BASE44_APP_ID` | App id the SDK talks to |
| `VITE_BASE44_APP_BASE_URL` | Base URL of the app's backend |
| `VITE_BASE44_FUNCTIONS_VERSION` | Version pin for backend function calls |
| `BASE44_LEGACY_SDK_IMPORTS` | Build flag: `true` enables the legacy `@/integrations`, `@/entities` import aliases |

No secret keys are needed by the app itself: Dropbox links are public share links, and
every privileged operation goes through a backend function that authenticates the caller
with the platform session.

## Running it locally

```bash
npm install
npm install -g base44@latest   # Base44 CLI
base44 login                   # once per machine
base44 link                    # once per clone; writes the app-id pointer
base44 dev                     # local backend + frontend together
```

Open the URL `base44 dev` prints (usually `http://localhost:5173`). The app must have been
published at least once for the UI to boot locally, and local entity data is in-memory —
it resets when `base44 dev` restarts. `npm run build` produces the production bundle;
`npm run lint` and `npm run typecheck` cover static checks.