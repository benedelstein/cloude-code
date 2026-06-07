# Frontend Styling

This document is the source of truth for web-client styling and component conventions.

## Stack

The web client uses:

- Next.js app router
- TypeScript
- Tailwind CSS
- shadcn/ui
- AI SDK
- Cloudflare Agents SDK

## Components

- Create separate components instead of nesting large blocks of UI inside one React component.
- Keep local components in the same file only when they are small and specific to that page.
- Move reusable components into `components/`.
- `components/ui` is generated from shadcn/ui. Use shadcn components for common primitives like tooltips, sidebars, toasts, dialogs, and menus.
- When uncertain about a shadcn component, check the shadcn docs instead of relying on memory.
- Use `next/link` for in-site navigation instead of a button with `onClick` or a plain `<a>` tag.

## Tailwind

- `globals.css` contains global Tailwind and CSS styling.
- Do not define local colors or fonts directly. Use variables from `globals.css`.
- DRY repeated Tailwind classes when the same class group appears across multiple elements or components.
- Tailwind breakpoints are mobile-first. Write base styles unprefixed for mobile, then use `md:` for the default desktop/tablet layout shift.
- Use `sm:` only when specifically targeting the large-phone range.
- Use `lg:` only when distinguishing tablet from desktop.

## Visual Validation

- After visual changes, validate the affected UI with the right Codex browser surface: Chrome plugin for
  logged-in/profile-dependent flows; in-app Browser for simple local/non-auth rendering checks.
- Capture a screenshot when the change affects layout, spacing, color, responsive behavior, or interaction state.
- Do not default to Playwright MCP unless the task specifically requires Playwright automation.
