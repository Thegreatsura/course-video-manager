import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { copyEntityLinkActions } from "@/features/entity-links/copy-entity-link-actions";
import {
  withLessonPlace,
  type EntityRef,
} from "@/features/entity-links/entity-deep-link";
import { useFindLessonPlace } from "@/features/entity-links/lesson-place-context";
import { CheckIcon } from "lucide-react";
import { Fragment } from "react";
import {
  layoutActionMenu,
  type ActionLeaf,
  type ActionMenuGroups,
  type LaidOutLeaf,
  type LaidOutPicker,
} from "./action-menu-model";

/** Which door the menu opens from: a right-click, or a button (Actions / "…"). */
export type MenuDoor = "context" | "dropdown";

const PARTS = {
  context: {
    Content: ContextMenuContent,
    Group: ContextMenuGroup,
    Item: ContextMenuItem,
    Label: ContextMenuLabel,
    RadioGroup: ContextMenuRadioGroup,
    RadioItem: ContextMenuRadioItem,
    Separator: ContextMenuSeparator,
    Shortcut: ContextMenuShortcut,
    Sub: ContextMenuSub,
    SubContent: ContextMenuSubContent,
    SubTrigger: ContextMenuSubTrigger,
  },
  dropdown: {
    Content: DropdownMenuContent,
    Group: DropdownMenuGroup,
    Item: DropdownMenuItem,
    Label: DropdownMenuLabel,
    RadioGroup: DropdownMenuRadioGroup,
    RadioItem: DropdownMenuRadioItem,
    Separator: DropdownMenuSeparator,
    Shortcut: DropdownMenuShortcut,
    Sub: DropdownMenuSub,
    SubContent: DropdownMenuSubContent,
    SubTrigger: DropdownMenuSubTrigger,
  },
} as const;

interface MenuContentProps {
  menu: MenuDoor;
  /** Declare each action under the group it belongs to; the menu orders, separates and styles them. */
  groups: ActionMenuGroups;
  /** Dropdown only: which edge of the trigger the menu lines up with. */
  align?: "start" | "center" | "end";
  className?: string;
  /** Where focus goes as the menu closes; `preventDefault()` keeps it where an item sent it. */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The menu of one entity — a Course, Lesson, Video, Clip… Renders the
 * entity's actions in canonical group order (CODING_STANDARDS.md, "Action
 * menus") and closes the copy group with Copy Link. Build `groups`
 * once and render it from both doors: `menu="context"` on the right-click and
 * `menu="dropdown"` on the Actions / "…" button. Pass `entity={null}` while
 * the entity is still being saved: Copy Link shows, disabled. A Video, or
 * anything on one, gets its Course, Section and Lesson from the nearest
 * `LessonPlaceProvider`, so the copied link names the whole hierarchy.
 */
export function EntityMenuContent({
  entity,
  ...props
}: MenuContentProps & { entity: EntityRef | null }) {
  const findPlace = useFindLessonPlace();
  return (
    <MenuContent
      {...props}
      appendToCopy={copyEntityLinkActions(
        entity && withLessonPlace(entity, findPlace)
      )}
    />
  );
}

/**
 * An action menu that is not about an entity — a calendar week, the
 * writer's document. Same rules, no Copy Link. A file that uses it
 * is listed in action-menus.test.ts's NOT_ENTITY_MENUS with the reason.
 */
export function ActionMenuContent(props: MenuContentProps) {
  return <MenuContent {...props} appendToCopy={[]} />;
}

function MenuContent({
  menu,
  groups,
  align,
  className,
  onCloseAutoFocus,
  appendToCopy,
}: MenuContentProps & { appendToCopy: readonly ActionLeaf[] }) {
  const P = PARTS[menu];
  const laidOut = layoutActionMenu(groups, appendToCopy);
  const contentProps =
    menu === "dropdown"
      ? { align, className, onCloseAutoFocus }
      : { className, onCloseAutoFocus };

  return (
    <P.Content {...contentProps}>
      {laidOut.map(({ group, items }, i) => (
        <Fragment key={group}>
          {i > 0 && <P.Separator />}
          <P.Group>
            {items.map((item) =>
              item.kind === "picker" ? (
                <Picker key={item.key} picker={item} menu={menu} />
              ) : item.kind === "submenu" ? (
                <P.Sub key={item.key}>
                  <P.SubTrigger
                    data-variant={item.destructive ? "destructive" : "default"}
                  >
                    <item.icon />
                    {item.label}
                  </P.SubTrigger>
                  <P.SubContent>
                    {item.items.map((leaf) => (
                      <Leaf key={leaf.key} leaf={leaf} menu={menu} />
                    ))}
                  </P.SubContent>
                </P.Sub>
              ) : (
                <Leaf key={item.key} leaf={item} menu={menu} />
              )
            )}
          </P.Group>
        </Fragment>
      ))}
    </P.Content>
  );
}

function Leaf({ leaf, menu }: { leaf: LaidOutLeaf; menu: MenuDoor }) {
  const P = PARTS[menu];
  return (
    <P.Item
      variant={leaf.destructive ? "destructive" : "default"}
      disabled={leaf.disabled}
      onSelect={leaf.onSelect}
      className={leaf.description ? "items-start" : undefined}
    >
      <leaf.icon className={leaf.description ? "mt-0.5" : undefined} />
      {leaf.description ? (
        <div className="flex flex-col">
          <span>{leaf.label}</span>
          <span className="text-xs text-muted-foreground">
            {leaf.description}
          </span>
        </div>
      ) : (
        leaf.label
      )}
      {leaf.checked && <CheckIcon className="ml-auto" />}
      {leaf.shortcut && <P.Shortcut>{leaf.shortcut}</P.Shortcut>}
    </P.Item>
  );
}

/** A value picker: a submenu of radio options, the current one marked. */
function Picker({ picker, menu }: { picker: LaidOutPicker; menu: MenuDoor }) {
  const P = PARTS[menu];
  return (
    <P.Sub>
      <P.SubTrigger>
        <picker.icon />
        {picker.label}
      </P.SubTrigger>
      <P.SubContent className="max-h-80 max-w-80 overflow-y-auto">
        <P.RadioGroup value={picker.value} onValueChange={picker.onValueChange}>
          {picker.runs.map((run, i) => (
            <Fragment key={`${i}-${run.heading ?? ""}`}>
              {run.heading && (
                <P.Label className="text-xs text-muted-foreground">
                  {run.heading}
                </P.Label>
              )}
              {run.options.map((option) => (
                <P.RadioItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.tag && (
                    <span className="rounded-sm bg-muted px-1 text-[10px] font-medium tabular-nums">
                      {option.tag}
                    </span>
                  )}
                  <span className="truncate">{option.label}</span>
                </P.RadioItem>
              ))}
            </Fragment>
          ))}
        </P.RadioGroup>
      </P.SubContent>
    </P.Sub>
  );
}
