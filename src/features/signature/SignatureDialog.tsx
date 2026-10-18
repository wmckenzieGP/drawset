/** Making and choosing your signatures: draw it, type your name, or use a photo or scan of it. */
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Pt } from "../../markup/geometry";
import type { MarkupImage } from "../../markup/model";
import { pickLocalFiles } from "../../platform/host";
import { flash, useApp } from "../../state/store";
import { addSignature, removeSignature, signWith, useSignatures } from "./signatures";
import { drawnSignature, fontStack, INK_COLOURS, installedScriptFonts, pictureSignature, strokePath, typedSignature, type InkColour } from "./signatureImage";

const PAD_W = 520;
const PAD_H = 170;
const PEN_PX = 2.6;

type Mode = "draw" | "type" | "picture";

export function SignatureDialog() {
  const open = useSignatures((s) => s.dialog);
  return open ? <SignatureDialogBody /> : null;
}

/** A thumbnail address for a saved signature (released when the dialog closes). */
function useImageUrl(image: MarkupImage | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return setUrl(null);
    const u = URL.createObjectURL(new Blob([image.data as Uint8Array<ArrayBuffer>], { type: image.mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);
  return url;
}

function SavedRow({ id, name, image, current }: { id: string; name: string; image: MarkupImage; current: boolean }) {
  const url = useImageUrl(image);
  return (
    <div className={`sig-item ${current ? "current" : ""}`} data-testid="sig-item">
      {url && <img src={url} alt="" />}
      <span className="sig-name">{name}</span>
      <button className="btn small primary" onClick={() => signWith(id)} data-testid="sig-use">
        Sign with this
      </button>
      <button className="btn small" onClick={() => removeSignature(id)} data-testid="sig-delete">
        Delete
      </button>
    </div>
  );
}

function SignatureDialogBody() {
  const list = useSignatures((s) => s.list);
  const current = useSignatures((s) => s.current);
  const caption = useSignatures((s) => s.caption);
  const author = useApp((s) => s.author);
  const [mode, setMode] = useState<Mode>("draw");
  // the name on the last signature used, or the reviewer name set in Preferences
  const [name, setName] = useState(() => list.find((x) => x.id === current)?.name ?? (author === "Drawset user" ? "" : author));
  const [colour, setColour] = useState<InkColour>("black");
  const fonts = useMemo(installedScriptFonts, []);
  const [font, setFont] = useState(fonts[0]);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [picture, setPicture] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [clearPaper, setClearPaper] = useState(true);
  const [pictureImage, setPictureImage] = useState<MarkupImage | null>(null);
  const pictureUrl = useImageUrl(pictureImage);
  const close = () => useSignatures.setState({ dialog: false });

  useEffect(() => {
    if (!picture) return setPictureImage(null);
    let live = true;
    pictureSignature(picture.bytes, clearPaper)
      .then((img) => live && setPictureImage(img))
      .catch(() => {
        if (live) flash(`${picture.name} could not be read as a picture.`, "error");
      });
    return () => {
      live = false;
    };
  }, [picture, clearPaper]);

  const save = async () => {
    const signer = name.trim();
    if (!signer) return flash("Type your name: it labels the signature and goes under it.", "error");
    const image = mode === "draw" ? await drawnSignature(strokes, PAD_W, PAD_H, colour, PEN_PX) : mode === "type" ? await typedSignature(signer, font, colour) : pictureImage;
    if (!image) return flash(mode === "draw" ? "Sign in the box first." : mode === "picture" ? "Choose a picture of your signature first." : "Type your name first.", "error");
    signWith(addSignature(signer, image));
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide signature-dialog" aria-describedby={undefined} data-testid="signature-dialog">
          <Dialog.Title>Signatures</Dialog.Title>
          {list.length > 0 && (
            <div className="sig-list">
              {list.map((s) => (
                <SavedRow key={s.id} id={s.id} name={s.name} image={s.image} current={s.id === current} />
              ))}
            </div>
          )}
          <div className="panel-subtitle">New signature</div>
          <div className="seg" role="tablist">
            {(["draw", "type", "picture"] as Mode[]).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={`seg-btn ${mode === m ? "active" : ""}`} onClick={() => setMode(m)} data-testid={`sig-mode-${m}`}>
                {m === "draw" ? "Draw" : m === "type" ? "Type" : "Picture"}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Your name (labels the signature and goes under it)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. William McKenzie" data-testid="sig-name" />
          </label>
          {mode === "draw" && <Pad strokes={strokes} onStrokes={setStrokes} colour={colour} />}
          {mode === "type" && (
            <div className="sig-fonts">
              {fonts.map((f) => (
                <label key={f} className={`sig-font ${font === f ? "active" : ""}`} style={{ fontFamily: fontStack(f), color: INK_COLOURS[colour] }}>
                  <input type="radio" checked={font === f} onChange={() => setFont(f)} data-testid="sig-font" />
                  {name.trim() || "Your name"}
                </label>
              ))}
            </div>
          )}
          {mode === "picture" && (
            <div className="sig-picture">
              <button
                className="btn"
                onClick={async () => {
                  const [f] = await pickLocalFiles("image/png,image/jpeg,image/gif,image/bmp,image/webp");
                  if (f) setPicture({ bytes: f.bytes, name: f.name });
                }}
                data-testid="sig-choose-picture"
              >
                Choose a photo or scan…
              </button>
              <label className="check">
                <input type="checkbox" checked={clearPaper} onChange={(e) => setClearPaper(e.target.checked)} data-testid="sig-clear-paper" /> Make the paper see-through
              </label>
              <div className="sig-preview">{pictureUrl ? <img src={pictureUrl} alt="Your signature" /> : <span className="muted">Sign a sheet of white paper, then photograph or scan it.</span>}</div>
            </div>
          )}
          {mode !== "picture" && (
            <div className="sig-colours">
              Ink
              {(Object.keys(INK_COLOURS) as InkColour[]).map((c) => (
                <label key={c} className="check">
                  <input type="radio" checked={colour === c} onChange={() => setColour(c)} data-testid={`sig-colour-${c}`} /> {c === "black" ? "Black" : "Blue"}
                </label>
              ))}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={caption} onChange={(e) => useSignatures.setState({ caption: e.target.checked })} data-testid="sig-caption" /> Put my name and the date under the signature
          </label>
          <p className="muted small-print">Your signatures are kept on this computer only. Once placed, a signature is part of the drawing like a signed print: anyone with the file can see it.</p>
          <div className="dialog-buttons">
            <Dialog.Close className="btn">Close</Dialog.Close>
            <button className="btn primary" onClick={() => void save()} data-testid="sig-save">
              Save and sign
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The box you sign in with the mouse, a pen or a finger. */
function Pad({ strokes, onStrokes, colour }: { strokes: Pt[][]; onStrokes: (s: Pt[][]) => void; colour: InkColour }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Pt[] | null>(null);
  const dpr = window.devicePixelRatio || 1;

  const paint = (extra?: Pt[]) => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, PAD_W, PAD_H);
    // the line to sign on
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(24, PAD_H - 34);
    g.lineTo(PAD_W - 24, PAD_H - 34);
    g.stroke();
    g.strokeStyle = INK_COLOURS[colour];
    g.lineWidth = PEN_PX;
    g.lineCap = "round";
    g.lineJoin = "round";
    strokePath(g, extra ? [...strokes, extra] : strokes);
  };
  useEffect(paint);

  const at = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  return (
    <div className="sig-pad-wrap">
      <canvas
        ref={ref}
        className="sig-pad"
        width={PAD_W * dpr}
        height={PAD_H * dpr}
        style={{ width: PAD_W, height: PAD_H }}
        data-testid="sig-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = [at(e)];
          paint(drawing.current);
        }}
        onPointerMove={(e) => {
          const s = drawing.current;
          if (!s) return;
          const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const ev of evs.length ? evs : [e.nativeEvent]) {
            const r = ref.current!.getBoundingClientRect();
            const p: Pt = [ev.clientX - r.left, ev.clientY - r.top];
            const last = s[s.length - 1];
            if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.8) s.push(p);
          }
          paint(s);
        }}
        onPointerUp={() => {
          if (drawing.current) onStrokes([...strokes, drawing.current]);
          drawing.current = null;
        }}
      />
      <div className="sig-pad-tools">
        <button className="btn small" onClick={() => onStrokes(strokes.slice(0, -1))} disabled={!strokes.length} data-testid="sig-undo">
          Undo stroke
        </button>
        <button className="btn small" onClick={() => onStrokes([])} disabled={!strokes.length} data-testid="sig-clear">
          Clear
        </button>
      </div>
    </div>
  );
}
