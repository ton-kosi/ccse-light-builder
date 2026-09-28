# CCSE Light Builder

PROJECT: CCSE ERP prototype v0
COMPANY: Chingchai & Sons Engineering (CCSE), Bangkok. Sells and installs
specialist lighting: LED linear (custom "Jedi" profiles), Neon/Jedi flex,
fiber optic starry ceilings, Clipso stretch ceilings, underwater lighting,
Smart Film. Most items are CUSTOM ASSEMBLIES, not catalog products.

LANGUAGE: All UI text in Thai. Code, table and column names in English.
Dates dd/mm/yyyy. Currency THB with thousands separators.

CORE CONCEPT — 3 LAYERS:
1. Customer layer = quotation lines (BOQ). Custom sales names that customers
   cannot compare elsewhere. Only lines with qty+unit show a price.
2. Internal recipe layer = sales_components + recipes (reusable), plus
   line_recipes (one-off custom recipe for a specific BOQ line).
3. Stock layer = skus (real items issued from the warehouse).
   Example: we SELL "LED JEDI 13.8W/M" but ISSUE SKU "LED strip 14.4W/m".

NON-NEGOTIABLE RULES:
- Technicians and production staff must NEVER see prices or costs.
- A work order may only be released when project status >= 6
  (deposit received OR CEO approved).
- Keep it simple. Prefer clear tables and forms over fancy UI.
- Before any destructive schema change, explain it and ask me first.
- Enable Row Level Security on every table.

OUT OF SCOPE FOR v0: payroll, HR, FlowAccount integration, technician
calendar, forecasting, mobile app.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/97bd31d7-9cbf-49b6-9d00-47247861a2a1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
