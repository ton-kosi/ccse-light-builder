/** Renders a print element into a multi-page A4 PDF (shared by quotation and billing documents). */
export async function buildA4Pdf(el: HTMLElement) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
  el.classList.add("pdf-capture");
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", ignoreElements: (n) => n.classList?.contains("no-print") });
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210, pageH = 297, margin = 8;
    const imgW = pageW - margin * 2;
    const pxPerMm = canvas.width / imgW;
    const sliceH = Math.floor((pageH - margin * 2) * pxPerMm);
    for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
      const h = Math.min(sliceH, canvas.height - y);
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = h;
      const context = c.getContext("2d");
      if (!context) throw new Error("ไม่สามารถสร้าง PDF ได้");
      context.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (page) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, imgW, h / pxPerMm);
    }
    return pdf;
  } finally {
    el.classList.remove("pdf-capture");
  }
}
