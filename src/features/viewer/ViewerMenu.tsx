/** The right-click menus of the page view: for markups, for the page, for selected text and for a shape being drawn. */
import * as Menu from "@radix-ui/react-dropdown-menu";
import { C, Item, Sep, Sub } from "../../app/menuItems";
import { cmd } from "../../app/commands";
import { pasteFromMenu } from "../../app/clipboard";
import { canFlip } from "../../markup/arrange";
import { STATUSES } from "../../markup/model";
import { type DocTab } from "../../state/store";
import { followLink } from "../links/navigate";
import { openLinkDialog } from "../links/LinkDialog";
import { deletePages, insertBlankPage, rotatePages } from "../pages/pageOps";
import { addSelectionToChest } from "../toolchest/ToolChestPanel";
import type { ContextTarget, Controller } from "./controller";

export interface MenuAt {
  x: number;
  y: number;
  target: ContextTarget;
}

export function ViewerMenu({ tab, menu, controller, onClose }: { tab: DocTab; menu: MenuAt | null; controller: Controller; onClose: () => void }) {
  return (
    <Menu.Root open={!!menu} onOpenChange={(o) => !o && onClose()} modal={false}>
      <Menu.Trigger asChild>
        <span style={{ position: "fixed", left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" side="bottom" collisionPadding={8} data-testid="context-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
          {menu?.target.t === "markup" && <MarkupRows tab={tab} target={menu.target} />}
          {menu?.target.t === "page" && <PageRows tab={tab} target={menu.target} />}
          {menu?.target.t === "text" && <TextRows />}
          {menu?.target.t === "drawing" && <DrawingRows target={menu.target} controller={controller} />}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MarkupRows({ tab, target }: { tab: DocTab; target: Extract<ContextTarget, { t: "markup" }> }) {
  const ms = target.ids.map((id) => tab.state.markups[id]).filter(Boolean);
  if (!ms.length) return null;
  const one = ms.length === 1 ? ms[0] : null;
  const unlocked = ms.some((m) => !m.locked);
  const allLocked = ms.every((m) => m.locked);
  const grouped = ms.some((m) => m.group) || ms.some((m) => Object.values(tab.state.markups).some((x) => x.group === m.id));
  const ours = ms.filter((m) => m.kind !== "foreign");
  const texty = ms.some((m) => m.kind === "textbox" || m.kind === "callout");
  return (
    <>
      {one && (one.kind === "textbox" || one.kind === "callout") && <Item label="Edit text" onSelect={() => cmd.editText(one.id)} disabled={one.locked} testId="cm-editText" />}
      {one?.kind === "link" && one.link && (
        <>
          <Item label="Follow link" onSelect={() => void followLink(tab, one.link!)} testId="cm-followLink" />
          <Item label="Change link…" onSelect={() => openLinkDialog({ editId: one.id })} disabled={one.locked} testId="cm-editLink" />
        </>
      )}
      <Item label="Properties" onSelect={() => cmd.showProperties()} testId="cm-properties" />
      {one && <Item label="Reply" onSelect={() => cmd.showProperties("reply-input")} testId="cm-reply" />}
      <Sub label="Status">
        {STATUSES.map((s) => (
          <Item key={s} label={`${ms.every((m) => m.status === s) ? "✓ " : ""}${s === "None" ? "No status" : s}`} onSelect={() => cmd.setStatus(target.ids, s)} testId={`cm-status-${s}`} />
        ))}
      </Sub>
      <Sep />
      <C id="edit.cut" disabled={!unlocked} />
      <C id="edit.copy" />
      <C id="edit.paste" run={() => void pasteFromMenu(target.at)} />
      <C id="edit.duplicate" disabled={!ours.length} />
      <C id="edit.delete" disabled={!unlocked} />
      <Sep />
      <C id="edit.formatPainter" disabled={!one || one.kind === "foreign"} />
      <Item label="Set as default" onSelect={cmd.setAsDefault} disabled={!ours.some((m) => m.kind !== "image" && m.kind !== "signature")} testId="cm-setDefault" />
      <Item label="Add to Tool Chest" onSelect={() => addSelectionToChest(tab)} disabled={!ours.length} testId="cm-addToChest" />
      <Sep />
      <Sub label="Arrange">
        <C id="edit.bringToFront" />
        <C id="edit.bringForward" />
        <C id="edit.sendBackward" />
        <C id="edit.sendToBack" />
      </Sub>
      <Sub label="Align and flip">
        <C id="edit.alignLeft" disabled={ms.length < 2} />
        <C id="edit.alignCentre" disabled={ms.length < 2} />
        <C id="edit.alignRight" disabled={ms.length < 2} />
        <C id="edit.alignTop" disabled={ms.length < 2} />
        <C id="edit.alignMiddle" disabled={ms.length < 2} />
        <C id="edit.alignBottom" disabled={ms.length < 2} />
        <Sep />
        <C id="edit.flipHorizontal" disabled={!ms.some(canFlip)} />
        <C id="edit.flipVertical" disabled={!ms.some(canFlip)} />
      </Sub>
      {grouped ? <C id="edit.ungroup" /> : <C id="edit.group" disabled={ms.length < 2} />}
      <C id="edit.lock" label={allLocked ? "Unlock" : "Lock"} />
      {texty && <C id="edit.autosize" disabled={!unlocked} />}
    </>
  );
}

function PageRows({ tab, target }: { tab: DocTab; target: Extract<ContextTarget, { t: "page" }> }) {
  const pageId = target.at.pageId;
  const mode = tab.view.mode;
  return (
    <>
      <C id="edit.paste" run={() => void pasteFromMenu(target.at)} />
      <C id="edit.pasteInPlace" />
      <C id="edit.selectAll" />
      <Sep />
      <C id="edit.undo" disabled={!tab.undo.length} label={tab.undo.length ? `Undo ${tab.undo[tab.undo.length - 1].label.toLowerCase()}` : undefined} />
      <C id="edit.redo" disabled={!tab.redo.length} label={tab.redo.length ? `Redo ${tab.redo[tab.redo.length - 1].label.toLowerCase()}` : undefined} />
      <Sep />
      <C id="view.prevView" disabled={!tab.nav.back.length} />
      <C id="view.nextView" disabled={!tab.nav.fwd.length} />
      <C id="view.zoomIn" />
      <C id="view.zoomOut" />
      <C id="view.fitPage" />
      <C id="view.fitWidth" />
      <Sub label="Page layout">
        <C id="view.single" checked={mode === "single"} />
        <C id="view.continuous" checked={mode === "continuous"} />
        <C id="view.sideBySide" checked={mode === "sideBySide"} />
        <C id="view.continuousSideBySide" checked={mode === "continuousSideBySide"} />
      </Sub>
      <Sep />
      <Sub label="Rotate page">
        <Item label="Clockwise" onSelect={() => rotatePages(tab.key, [pageId], 90)} testId="cm-rotatePageCw" />
        <Item label="Anticlockwise" onSelect={() => rotatePages(tab.key, [pageId], 270)} testId="cm-rotatePageCcw" />
        <Item label="180°" onSelect={() => rotatePages(tab.key, [pageId], 180)} testId="cm-rotatePage180" />
      </Sub>
      <Item label="Insert blank page after" onSelect={() => void insertBlankPage(tab.key, target.index + 1)} testId="cm-insertBlank" />
      <C id="doc.insertPages" />
      <C id="doc.extract" />
      <Item label="Delete page" onSelect={() => deletePages(tab.key, [pageId])} disabled={tab.state.pages.length < 2} testId="cm-deletePage" />
      <Sep />
      <C id="doc.addBookmark" />
    </>
  );
}

function TextRows() {
  return (
    <>
      <C id="edit.copy" label="Copy text" />
      <Sep />
      <Item label="Highlight" onSelect={() => cmd.markText("highlight")} testId="cm-textHighlight" />
      <Item label="Underline" onSelect={() => cmd.markText("underline")} testId="cm-textUnderline" />
      <Item label="Strikethrough" onSelect={() => cmd.markText("strikeout")} testId="cm-textStrikeout" />
    </>
  );
}

function DrawingRows({ target, controller }: { target: Extract<ContextTarget, { t: "drawing" }>; controller: Controller }) {
  return (
    <>
      <Item label="Finish" shortcut="Enter" onSelect={() => controller.finishPoly()} testId="cm-drawFinish" />
      <Item label="Remove last point" shortcut="Backspace" onSelect={() => controller.removeLastPoint()} disabled={target.points < 2} testId="cm-drawUndoPoint" />
      <Item label="Cancel" shortcut="Esc" onSelect={() => controller.discard()} testId="cm-drawCancel" />
    </>
  );
}
