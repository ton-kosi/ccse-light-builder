import { Camera, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cleanScan } from "@/lib/barcode";

/**
 * Scan field: a USB / Bluetooth scanner types the code and presses Enter here; on phones the
 * camera button reads QR codes and barcodes. Typing a code by hand + Enter works the same way.
 */
export function ScanBox({
  onScan,
  placeholder = "สแกนหรือพิมพ์รหัส แล้วกด Enter",
  autoFocus = false,
  className,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = (raw: string) => {
    const code = cleanScan(raw);
    setValue("");
    if (code) onScan(code);
    input.current?.focus();
  };

  return (
    <div className={"flex gap-2 " + (className ?? "")}>
      <div className="relative flex-1">
        <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          ref={input}
          className="pl-8 font-mono"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(value);
            }
          }}
        />
      </div>
      <Button type="button" variant="outline" onClick={() => setCamera(true)} title="สแกนด้วยกล้อง">
        <Camera className="h-4 w-4" />
        <span className="hidden sm:inline">กล้อง</span>
      </Button>
      {camera ? (
        <CameraScanner
          onClose={() => setCamera(false)}
          onResult={(code) => {
            setCamera(false);
            submit(code);
          }}
        />
      ) : null}
    </div>
  );
}

const FORMATS = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "data_matrix"];

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Built-in reader where the browser has one (Chrome on Android), else the bundled one (iPhone). */
async function makeDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (native) return new native({ formats: FORMATS });
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: FORMATS as never[] }) as unknown as Detector;
}

/** Back camera in a dialog; closes on the first code it reads. */
function CameraScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // latest callback without restarting the camera on every parent render
  const result = useRef(onResult);
  result.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("เบราว์เซอร์นี้เปิดกล้องไม่ได้");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = await makeDetector();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const code = found.find((f) => f.rawValue)?.rawValue;
            if (code) {
              stopped = true;
              navigator.vibrate?.(80);
              result.current(code);
              return;
            }
          } catch {
            /* frame not ready yet */
          }
          timer = setTimeout(tick, 250);
        };
        void tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /denied|NotAllowed|Permission/i.test(msg)
            ? "ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้เว็บนี้ในการตั้งค่าเบราว์เซอร์"
            : /NotFound|Requested device/i.test(msg)
              ? "ไม่พบกล้องในเครื่องนี้"
              : msg,
        );
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>สแกนด้วยกล้อง</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-md bg-black">
              <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80" />
            </div>
            <p className="text-center text-xs text-muted-foreground">เล็ง QR หรือบาร์โค้ดให้อยู่ในกรอบ ห่างประมาณ 10–20 ซม.</p>
          </>
        )}
        <Button variant="outline" onClick={onClose}>
          ปิด
        </Button>
      </DialogContent>
    </Dialog>
  );
}
