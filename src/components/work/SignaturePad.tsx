import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type SignaturePadHandle = {
  /** PNG of the signature, or null when nothing was drawn */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
};

/** Customer signs with a finger (phone/tablet) or the mouse. Always black ink on white. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (signed: boolean) => void }>(
  function SignaturePad({ onChange }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const [signed, setSigned] = useState(false);

    // match the bitmap to the displayed size (sharp on high-DPI screens)
    useEffect(() => {
      const c = canvas.current;
      if (!c) return;
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = c.getBoundingClientRect();
      c.width = Math.round(width * ratio);
      c.height = Math.round(height * ratio);
      const ctx = c.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111";
    }, []);

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const mark = (v: boolean) => {
      setSigned(v);
      onChange?.(v);
    };

    useImperativeHandle(ref, () => ({
      toBlob: () =>
        new Promise((resolve) => {
          if (!signed || !canvas.current) return resolve(null);
          canvas.current.toBlob((b) => resolve(b), "image/png");
        }),
      clear: () => {
        const c = canvas.current;
        if (!c) return;
        const ctx = c.getContext("2d")!;
        const { width, height } = c.getBoundingClientRect();
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        mark(false);
      },
    }));

    return (
      <div>
        <canvas
          ref={canvas}
          className="h-40 w-full touch-none rounded-md border border-input bg-white"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const { x, y } = point(e);
            const ctx = e.currentTarget.getContext("2d")!;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
            if (!signed) mark(true);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const { x, y } = point(e);
            const ctx = e.currentTarget.getContext("2d")!;
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{signed ? "ลงชื่อแล้ว" : "ให้ลูกค้าเซ็นในกรอบนี้"}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const c = canvas.current;
              if (!c) return;
              const ctx = c.getContext("2d")!;
              const { width, height } = c.getBoundingClientRect();
              ctx.fillStyle = "#fff";
              ctx.fillRect(0, 0, width, height);
              mark(false);
            }}
          >
            ล้าง
          </Button>
        </div>
      </div>
    );
  },
);
