---
created: 2026-06-30T21:20:09+0200
title: Localize the web surface
area: ui
files:
  - apps/web/src/components/Shell.astro
  - apps/web/src/components/DropLayer.astro
  - apps/web/src/pages/index.astro
  - apps/web/src/pages/login.astro
  - apps/web/src/pages/intake.astro
  - apps/web/src/pages/bibliography/import.astro
---

## Problem

The Seshat web surface currently hardcodes English copy. The shared ecosystem needs
Spanish, English, and French across navigation, authentication, global file drop,
intake, bibliography organization, validation messages, and status labels.

## Solution

Introduce locale-prefixed routes (`/es`, `/en`, `/fr`), automatic negotiation at `/`,
a persistent language selector, and centralized typed message dictionaries. Bibliographic
records and source documents must preserve their own language independently of interface locale.
