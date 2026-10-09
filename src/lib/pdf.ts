/**
 * Picks where each A4 page ends (in canvas pixels) so a page break never cuts through
 * a "keep" block (table rows, or anything marked data-pdf-keep) unless the block is
 * taller than a whole page. Pure function so it can be unit tested.
 */
export function pageBreaks(
  totalHeight: number,
  pageHeight: number,
  keeps: { top: number; bottom: number }[],
): number[] {
  const ends: number[] = [];
  let y = 0;
  while (y < totalHeight) {
    let cut = Math.min(y + pageHeight, totalHeight);
    if (cut < totalHeight) {
      for (let i = 0; i < 10; i++) {
        const spanning = keeps.filter(
          (k) => k.top > y && k.top < cut && k.bottom > cut && k.bottom - k.top < pageHeight,
        );
        if (!spanning.length) break;
        const next = Math.min(...spanning.map((k) => k.top));
        // never leave a page less than a fifth full just to keep a block together
        if (next - y < pageHeight * 0.2) break;
        cut = next;
      }
    }
    ends.push(cut);
    y = cut;
  }
  return ends;
}

/** Renders a print element into a multi-page A4 PDF (shared by quotation and billing documents). */
export async function buildA4Pdf(el: HTMLElement) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);
  el.classList.add("pdf-capture");
  // Hide on-screen buttons for real (not only in the capture) so measured positions match the image.
  const hidden = Array.from(el.querySelectorAll<HTMLElement>(".no-print"));
  const prevDisplay = hidden.map((n) => n.style.display);
  hidden.forEach((n) => (n.style.display = "none"));
  try {
    const box = el.getBoundingClientRect();
    const blocks = Array.from(el.querySelectorAll<HTMLElement>("tr, [data-pdf-keep]")).map((n) => {
      const r = n.getBoundingClientRect();
      return { top: r.top - box.top, bottom: r.bottom - box.top };
    });

    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
    const ratio = canvas.width / box.width;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210,
      pageH = 297,
      margin = 8;
    const imgW = pageW - margin * 2;
    const pxPerMm = canvas.width / imgW;
    const sliceH = Math.floor((pageH - margin * 2) * pxPerMm);
    const keeps = blocks.map((b) => ({ top: b.top * ratio, bottom: b.bottom * ratio }));
    // Ignore the element's bottom padding so it can't spill onto an empty extra page.
    const contentBottom = Math.max(
      0,
      ...Array.from(el.children).map((n) => n.getBoundingClientRect().bottom - box.top),
    );
    const total = Math.min(canvas.height, Math.ceil((contentBottom + 4) * ratio));

    let y = 0;
    pageBreaks(total, sliceH, keeps).forEach((end, page) => {
      const h = Math.round(end - y);
      const c = document.createElement("canvas");
      c.width = canvas.width;
      c.height = h;
      const context = c.getContext("2d");
      if (!context) throw new Error("ไม่สามารถสร้าง PDF ได้");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, c.width, h);
      context.drawImage(canvas, 0, Math.round(y), canvas.width, h, 0, 0, canvas.width, h);
      if (page) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, imgW, h / pxPerMm);
      y = end;
    });
    return pdf;
  } finally {
    hidden.forEach((n, i) => (n.style.display = prevDisplay[i] ?? ""));
    el.classList.remove("pdf-capture");
  }
}
