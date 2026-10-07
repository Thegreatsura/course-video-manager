import { fromPartial } from "@total-typescript/shoehorn";
import { userEvent } from "@vitest/browser/context";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { Lesson } from "./course-view-types";
import { LessonTitleEditor } from "./lesson-title-editor";

/**
 * A parent that leaves the input mounted after Enter or Escape, so the blur
 * that follows actually reaches the component. sortable-lesson-item.tsx
 * unmounts the input in the same commit, and React drops the blur Chromium
 * fires on removal — but the guard is the component's own promise, so it is
 * pinned here for any parent that closes the editor a beat later.
 */
function renderEditor() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  function Parent() {
    const [value, setValue] = useState("Intro");
    return (
      <>
        <LessonTitleEditor
          lesson={fromPartial<Lesson>({ id: "l1", title: "Intro" })}
          isReadOnly={false}
          editingTitle
          titleValue={value}
          onTitleValueChange={setValue}
          onCancel={onCancel}
          onSave={onSave}
          onStartEditing={() => {}}
        />
        <button>elsewhere</button>
      </>
    );
  }
  const screen = render(<Parent />);
  return { screen, onSave, onCancel };
}

describe("<LessonTitleEditor>", () => {
  it("saves the typed title when focus leaves the input", async () => {
    const { screen, onSave } = renderEditor();
    await screen.getByRole("textbox").fill("Welcome");

    await userEvent.tab();

    expect(onSave).toHaveBeenCalledWith("Welcome");
  });

  it("Enter saves once, not again on the blur that follows", async () => {
    const { screen, onSave } = renderEditor();
    await screen.getByRole("textbox").fill("Welcome");

    await userEvent.keyboard("{Enter}");
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels, and the blur that follows does not save", async () => {
    const { screen, onSave, onCancel } = renderEditor();
    await screen.getByRole("textbox").fill("Welcome");

    await userEvent.keyboard("{Escape}");
    await userEvent.tab();

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
