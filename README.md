# AccessAble

A web platform connecting persons with disabilities (PWDs) with vetted jobs, beneficiary aid, training programs, and community events—with accommodations confirmed upfront.

---

## Overview

Many inclusive and PWD-targeted opportunities go unnoticed because they are scattered across fragmented job boards, corporate websites, and community groups. When opportunities are found, critical accessibility details—such as physical accessibility, sign language interpretation, or assistive tech compatibility—are often omitted or treated as an afterthought.

**AccessAble** eliminates the guesswork by serving as a single discovery engine where all listings feature transparent, standardized accommodation specifications.

---

## Core Features

### 1. Zero-Barrier Opportunity Discovery

* **Faceted Accommodation Search:** Filter by specific accessibility provisions including Screen Reader Compatibility, Wheelchair / Step-Free Access, ASL / CART Interpreting, and Neurodivergent-Friendly environments.


* **Opportunity Categories:** jobs, apprenticeships, fellowships, events, and grant programs.


* **Flexible Work Formats:** Filter by Remote Only, Hybrid, or On-site Verified listings.


* **Accommodation Badges:** Visual and machine-readable accommodation indicators directly on listing cards.



### 2. Detailed Accommodation Transparency

* Dedicated accommodation panels detailing on-site access, digital format readiness, and point-of-contact details for custom adjustments.
* Alternative submission pathways (supporting voice notes, plain text, and video applications).

### 3. Submission & Moderation Pipeline

* Guided posting flow for employers and event hosts with mandatory accommodation disclosures.
* Administrative verification pipeline to ensure opportunities adhere to accessibility standards prior to publication.

### 4. Built-in Accessibility Toolkit

* High-contrast theme toggle.


* Dynamic typography scaling and dyslexia-friendly font settings.


* Full keyboard navigability with skip-to-content links and screen-reader announcements.

---

## Accessibility Standards

AccessAble is architected to meet **WCAG 2.1 Level AA/AAA** and **ADA compliance guidelines**:

* **Semantic HTML5:** Native landmark tags (`<main>`, `<nav>`, `<aside>`, `<header>`) for predictable screen-reader navigation.
* **ARIA Support:** Dynamic live regions (`aria-live`) for live search results, filter counts, and modal states.
* **Keyboard Navigation:** Logical tab ordering, visible focus outlines, and keyboard traps avoided across all overlays.
* **Color Contrast:** Strict contrast compliance across both default and high-contrast modes.

---

## Tech Stack

* **Frontend:** Create React App (`react-scripts` 5.0.1), React 19.3, JavaScript (no Next.js / App Router, no TypeScript)
* **Styling & Components:** Tailwind CSS 3.4, `@tailwindcss/forms`, PostCSS + Autoprefixer, Material Symbols Outlined, Plus Jakarta Sans / Inter / Lexend / OpenDyslexic fonts (no Radix UI / Headless UI, no Lucide Icons)
* **State & Data Fetching:** React hooks (`useState` / `useEffect` / `useMemo`), Firebase Realtime Database realtime subscriptions (`onValue`), `localStorage` draft persistence (no TanStack Query, no Zustand)
* **Database & Backend:** Firebase Realtime Database (`europe-west1`, project `accessablebyhex`) + Firebase Storage (opportunity logos), Firebase Hosting with SPA rewrites (no Supabase / PostgreSQL, no Row-Level Security, no Auth in use)
* **Testing & Perf:** Jest + React Testing Library (`@testing-library/react` / `jest-dom` / `user-event`), `web-vitals` (no `@axe-core/react`, Playwright, or Lighthouse CI configured)

---

## Getting Started

### Prerequisites

* Node.js `>= 18.x`
* npm (repo uses `package-lock.json`)

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/gutu-blip/AccessAble.git
cd AccessAble

```


2. **Install dependencies:**
```bash
npm install

```


3. **Configure environment variables:**
No `.env.local` file is required. The Firebase config is hardcoded in `src/firebase.js` (project `accessablebyhex`, RTDB `https://accessablebyhex-default-rtdb.europe-west1.firebasedatabase.app`). `.env.local` is gitignored but unused.


4. **Run the development server:**
```bash
npm start

```


Open [http://localhost:3000](http://localhost:3000?utm_source=gemini) in your browser.

---

## Testing for Accessibility

Run tests and builds with the available CRA scripts:

```bash
# Run Jest tests in interactive watch mode (React Testing Library)
npm test

# Create a production build in the `build/` folder (served by Firebase Hosting)
npm run build

```

There are no `test:a11y`, `test:e2e`, or `lint` scripts in `package.json`.

---

## Project Structure

```text
AccessAble/
├── public/               # CRA static assets (index.html, manifest.json, icons)
├── build/                # Production build output (Firebase Hosting `public` dir)
├── src/
│   ├── index.js          # ReactDOM entry point
│   ├── App.js            # Page router (home / details / submission via useState)
│   ├── Home.js           # Home discovery feed, search, filters, bookmarks
│   ├── Details.js        # Opportunity detail page
│   ├── SubmissionForm.js # Multi-step posting form (Basic / Logistics / Accommodations)
│   ├── firebase.js       # Hardcoded Firebase app / RTDB / Storage init
│   ├── services/
│   │   └── opportunities.js # RTDB CRUD, subscriptions, validation (schemaVersion: 1)
│   ├── index.css         # Tailwind directives + a11y helpers
│   ├── App.css
│   └── App.test.js       # Default CRA Jest test
├── firebase.json         # Hosting: `public: build` + SPA rewrites to /index.html
├── .firebaserc           # Default Firebase project: `accessablebyhex`
├── database.rules.json   # RTDB validation rules for `opportunities` / `saved`
├── tailwind.config.js    # Tailwind 3.4 tokens, `darkMode: 'class'`
└── postcss.config.js     # tailwindcss + autoprefixer

```

---

## Reporting Accessibility Barriers

If you encounter an accessibility barrier or bug anywhere on the platform, please file an issue with the tag `[accessibility]` or contact the core team directly at `accessibility@accessable.org`.

---

## License

Distributed under the MIT License. See `LICENSE` for details.
