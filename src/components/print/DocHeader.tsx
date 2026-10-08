/** Company header shared by all customer documents (quotation, billing). */
export function DocHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex items-start justify-between border-b-2 border-foreground pb-2">
      <div>
        <div className="text-lg font-bold">Chingchai &amp; Sons Engineering</div>
        <div className="text-xs">CCSE · Bangkok</div>
      </div>
      <div className="text-right">
        <div className="text-xl font-bold tracking-wide">{title}</div>
        <div>{subtitle}</div>
      </div>
    </header>
  );
}
