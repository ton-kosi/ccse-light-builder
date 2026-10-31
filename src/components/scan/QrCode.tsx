import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR code as crisp SVG (prints sharp on a 203 dpi label printer). */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [value]);
  return <div className={className} aria-label={`QR ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Same QR as an SVG string, for labels written into a new window (remnant labels). */
export function qrSvg(value: string): Promise<string> {
  return QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}
