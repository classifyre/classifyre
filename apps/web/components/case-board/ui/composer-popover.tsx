"use client";

import * as React from "react";
import { BOARD_HYPOTHESIS_TITLE_MAX_CHARS, BOARD_NOTE_MAX_CHARS } from "@workspace/schemas/case-board";
import { Popover, PopoverAnchor, PopoverContent } from "@workspace/ui/components/popover";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUi, useUiStore } from "../store/board-context";
import { addComment, createHypothesis } from "../store/commands";

/**
 * The small composer that opens where a comment pin or hypothesis card is
 * being placed. Posting creates the thread and its board item in one op;
 * Escape leaves nothing behind.
 */
export function ComposerPopover() {
  const { t } = useTranslation();
  const composer = useUi((s) => s.composer);
  const ui = useUiStore();
  const store = useBoardStore();
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    if (composer) setText("");
  }, [composer]);

  if (!composer) return null;
  const close = () => ui.getState().set({ composer: null });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    if (composer.kind === "comment") {
      const cmd = addComment(body, composer.anchor, composer.at);
      store.getState().run(cmd);
    } else {
      const cmd = createHypothesis(body, composer.at, composer.supports ?? []);
      store.getState().run(cmd);
    }
    ui.getState().set({ composer: null, tool: "select" });
  };

  const isComment = composer.kind === "comment";
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{ position: "fixed", left: composer.screen.x, top: composer.screen.y, width: 1, height: 1 }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 space-y-2 p-2"
        onKeyDown={(e) => e.stopPropagation()}
        data-testid="composer-popover"
      >
        <Textarea
          autoFocus
          rows={3}
          value={text}
          maxLength={isComment ? BOARD_NOTE_MAX_CHARS : BOARD_HYPOTHESIS_TITLE_MAX_CHARS}
          placeholder={isComment ? t("caseBoard.comment.placeholder") : t("caseBoard.hypothesis.placeholder")}
          className="resize-none text-sm"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
            // Enter posts a hypothesis statement; comments take Cmd/Ctrl+Enter
            // so they can span lines.
            if (e.key === "Enter" && (!isComment ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            {t("caseBoard.link.cancel")}
          </Button>
          <Button size="sm" disabled={!text.trim()} onClick={submit}>
            {isComment ? t("caseBoard.comment.post") : t("caseBoard.hypothesis.create")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
