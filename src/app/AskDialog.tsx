/** A small in-app text prompt (Electron does not support window.prompt). */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";

interface Ask {
  title: string;
  label: string;
  initial: string;
  password: boolean;
  note?: string;
  ok: string;
  resolve: (v: string | null) => void;
}

const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

/** Asks for a line of text; null when cancelled. */
export function askText(opts: { title: string; label: string; initial?: string; password?: boolean; note?: string; ok?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useAsk.getState().ask?.resolve(null);
    useAsk.setState({ ask: { initial: "", password: false, ok: "OK", ...opts, resolve } });
  });
}

export function AskDialog() {
  const ask = useAsk((s) => s.ask);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!ask) return;
    setValue(ask.initial);
    requestAnimationFrame(() => input.current?.select());
  }, [ask]);
  if (!ask) return null;
  const done = (v: string | null) => {
    useAsk.setState({ ask: null });
    ask.resolve(v);
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && done(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined} data-testid="ask-dialog">
          <Dialog.Title>{ask.title}</Dialog.Title>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              done(value);
            }}
          >
            <label className="field">
              <span>{ask.label}</span>
              <input ref={input} type={ask.password ? "password" : "text"} value={value} onChange={(e) => setValue(e.target.value)} autoFocus data-testid="ask-input" autoComplete="off" />
            </label>
            {ask.note && <p className="muted">{ask.note}</p>}
            <div className="dialog-buttons">
              <button type="button" className="btn" onClick={() => done(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" data-testid="ask-ok">
                {ask.ok}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
