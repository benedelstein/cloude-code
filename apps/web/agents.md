# Cloude Code Web Client

This is a next js web client. It uses:
- Next js app router
- typescript
- tailwind css
- shadcn ui
- AI SDK
- Cloudflare Agents SDK

## Important guidelines

- Create separate components - do not nest things inside one react component. You can keep the components locally in the same file if they are local to that page, or make a separate component in the components/ directory if they are reusable. Long, nested html is hard to read.
- components/ui is generated from the shadcn library. We use shadcn for common components like tooltips, sidebars, toasts, etc. 
   see https://ui.shadcn.com/docs for docs on a component if you are not certain - prefer to look up docs than to rely on your knowledge if unsure.
- For tailwind classes, DRY if they are repeated across multiple divs or components.
- Tailwind breakpoints are mobile-first (min-width, size and up). Write base styles unprefixed for mobile, then use `md:` (≥768px) as the default breakpoint for desktop/tablet layout shifts. Only reach for `sm:` (≥640px) when you specifically need to catch the large-phone range, or `lg:` (≥1024px) for tablet-vs-desktop distinctions.
- Use next/Link for in-site navigation instead of a button with onClick or an <a> tag.

globals.css contains global tailwind and css styling. Do not directly define local colors or fonts, always use variables from that file.

After completing visual changes, use a relevant browser tool to validate your changes by taking a screenshot.