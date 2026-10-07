<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep initial revision A stored internally and centralize its visible suffix in the BOQ helper; this preserves revision copying without schema changes.
- Quotation preview and PDF share the same print view and cut-length formatting to keep customer documents consistent.
- Fit individual quotation description lines to their measured print-column width while preserving manual line breaks; this prevents unwanted wrapping on A4 documents.
- Render BOQ component suggestions in a positioned portal outside the scrolling table; this prevents the dropdown from being clipped by its scroll container.
