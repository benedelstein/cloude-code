# Cloude Code Web Client

## Important guidelines

- Create separate components when a page or component is getting too long or nested. You can keep the components locally in the same file if they are local to that page, or make a separate component in the components/ directory if they are reusable. Long, nested html is hard to read.
- components/ui is generated from the shadcn library. We use shadcn for common components like tooltips, sidebars, toasts, etc. 
   see https://ui.shadcn.com/docs for docs on a component if you are not certain - prefer to look up docs than to rely on your knowledge if unsure.
- For tailwind classes, prefer to DRY if they are repeated across multiple divs or components.

globals.css contains global tailwind and css styling. 

After completing visual changes, use the playwright tool to validate your changes.