import { useEffect, useRef, useState } from "react";
import { textDrop, textPadding, textBoxHeight, wrapText } from "../../markup/appearance";
import { rgbCss } from "../../markup/draw";
import type { Rect } from "../../markup/geometry";
import { nowIso, type Markup } from "../../markup/model";
import { commit, withMarkups, type DocTab } from "../../state/store";
import { useInteraction } from "./controller";

const CSS_FONTS: Record<string, string> = {
  Helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  "Times-Roman": "'Times New Roman', Times, 'Liberation Serif', serif",
  Courier: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/** In-place editor for text boxes and callouts. Commits on blur, Escape or Ctrl+Enter. */
export function TextEditor({ tab, markup, rect, scale }: { tab: DocTab; markup: Markup; rect: Rect; scale: number }) {
  const [text, setText] = useState(markup.contents);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    useInteraction.setState({ editingId: null });
    if (text.trim() === "" && markup.contents === "") {
      commit(tab.key, "Remove empty text box", (s) => withMarkups(s, [], [markup.id]));
      return;
    }
    if (text === markup.contents) return;
    // grow the box downwards to fit the text
    const s = markup.style;
    const need = textBoxHeight(s.fontFamily, s.fontSize, text, markup.rect[2] - markup.rect[0], textPadding(markup));
    const r = markup.rect;
    const rectNew: Rect = need > r[3] - r[1] ? [r[0], r[1], r[2], r[1] + need] : r;
    commit(tab.key, "Edit text", (st) => withMarkups(st, [{ ...markup, contents: text, rect: rectNew, modified: nowIso() }]));
  };

  const s = markup.style;
  const padPts = textPadding(markup);
  const pad = padPts * scale;
  // the lines sit at the top, middle or bottom of the box while typing, as they will when drawn
  const lines = wrapText(s.fontFamily, s.fontSize, text, Math.max(1, markup.rect[2] - markup.rect[0] - 2 * padPts)).length;
  const drop = textDrop(s.fontSize, lines, markup.rect[3] - markup.rect[1] - 2 * padPts, s.valign) * scale;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      data-testid="text-editor"
      value={text}
      spellCheck
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finish();
        }
      }}
      style={{
        left: rect[0],
        top: rect[1],
        width: rect[2] - rect[0],
        minHeight: rect[3] - rect[1],
        // with room to spare the box keeps its own height, so the padding above the lines does not stretch it
        height: drop > 0 ? rect[3] - rect[1] : undefined,
        padding: pad,
        paddingTop: pad + drop,
        fontSize: s.fontSize * scale,
        lineHeight: 1.2,
        fontFamily: CSS_FONTS[s.fontFamily],
        color: rgbCss(s.textColor),
        textAlign: (["left", "center", "right"] as const)[s.align],
        background: s.fill ? rgbCss(s.fill) : "rgba(255,255,255,0.85)",
      }}
    />
  );
}
