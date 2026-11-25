"use client";

import * as React from "react";
import { BOARD_HYPOTHESIS_TITLE_MAX_CHARS, BOARD_NOTE_MAX_CHARS } from "@workspace/schemas/case-board";
import { Popover, PopoverAnchor, PopoverContent } from "@workspace/ui/components/popover";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUi, useUiStore } from "../store/board-context";
import { addComment, createHypothesis } from "../store/commands";

export interface CommentComposerPopoverProps {
  open: boolean;
  screen: { x: number; y: number } | null;
  placeholder: string;
  submitLabel: string;
  cancelLabel: string;
  maxLength?: number;
  multilineEnter?: boolean;
  busy?: boolean;
  header?: React.ReactNode;
  testId?: string;
  onClose: () => void;
  onSubmit: (body: string) => void | Promise<void>;
}

/**
 * Floating anchored popover composer shared by investigation boards and data
 * request canvases.
 */
export function CommentComposerPopover({
  open,
  screen,
  placeholder,
  submitLabel,
  cancelLabel,
  maxLength = BOARD_NOTE_MAX_CHARS,
  multilineEnter = true,
  busy = false,
  header,
  testId = "composer-popover",
  onClose,
  onSubmit,
}: CommentComposerPopoverProps) {
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    if (open) setText("");
  }, [open, screen?.x, screen?.y]);

  if (!open || !screen) return null;

  const submit = () => {
    const body = text.trim();
    if (!body || busy) return;
    void onSubmit(body);
  };

  return (
    <Popover open onOpenChange={(next) => !next && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: screen.x,
            top: screen.y,
            width: 1,
            height: 1,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 space-y-2 p-2"
        onKeyDown={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        {header}
        <Textarea
          autoFocus
          rows={3}
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          className="resize-none text-sm"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
            if (
              e.key === "Enter" &&
              (multilineEnter ? e.metaKey || e.ctrlKey : !e.shiftKey)
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button size="sm" disabled={!text.trim() || busy} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

  if (!composer) return null;
  const close = () => ui.getState().set({ composer: null });
  const isComment = composer.kind === "comment";

  return (
    <CommentComposerPopover
      open
      screen={composer.screen}
      maxLength={
        isComment ? BOARD_NOTE_MAX_CHARS : BOARD_HYPOTHESIS_TITLE_MAX_CHARS
      }
      multilineEnter={isComment}
      placeholder={
        isComment
          ? t("caseBoard.comment.placeholder")
          : t("caseBoard.hypothesis.placeholder")
      }
      submitLabel={
        isComment
          ? t("caseBoard.comment.post")
          : t("caseBoard.hypothesis.create")
      }
      cancelLabel={t("caseBoard.link.cancel")}
      onClose={close}
      onSubmit={(body) => {
        if (composer.kind === "comment") {
          store.getState().run(addComment(body, composer.anchor, composer.at));
        } else {
          store
            .getState()
            .run(createHypothesis(body, composer.at, composer.supports ?? []));
        }
        ui.getState().set({ composer: null, tool: "select" });
      }}
    />
  );
}
