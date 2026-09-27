# AccessAble

**🌐 Live Website:** [accessablebyhex.web.app](https://accessablebyhex.web.app)

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
git clone [https://github.com/gutu-blip/AccessAble.git](https://github.com/gutu-blip/AccessAble.git)
cd AccessAble
