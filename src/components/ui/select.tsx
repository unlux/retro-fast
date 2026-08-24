import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"

/**
 * Select, restyled for the printed form.
 *
 * Built on **Base UI** rather than Radix. The visual result is identical —
 * the 6px control radius, no shadows, the grey field rule instead of `border-input`, no
 * coloured focus ring (global.css draws one black outline for every control),
 * and `w-full` on the trigger so every picker is the same width regardless of
 * which sprint is selected — but the scroll lock underneath is different, and
 * that is the whole reason for the swap.
 *
 * Radix's scroll lock (`react-remove-scroll`) hides the scrollbar by setting
 * `overflow: hidden` on `body`, then tries to put the freed width back by
 * writing `padding`/`margin-right` compensation into an injected stylesheet.
 * Compensating for a removed scrollbar is a losing game: the value has to be
 * measured, it has to be applied to the right box, and any page style that also
 * touches body padding is now in a cascade fight with it.
 *
 * Base UI never removes the scrollbar's space. It locks on `<html>` — the box
 * that actually owns the viewport scrollbar — and holds the gutter open with
 * `scrollbar-gutter: stable` for the duration of the lock, so the scrollbar's
 * width is still reserved while the menu is open. Nothing has to be measured
 * and nothing is added back, so there is nothing to get wrong.
 *
 * The exported names and prop shapes match the previous shadcn/Radix API so the
 * call sites in RetroForm did not have to change.
 */

/**
 * A value -> label map for the current `<Select>`, read by `<SelectValue>`.
 *
 * Radix's `Select.Value` took its text from the selected `Item`'s `ItemText`,
 * so the call sites stated each option exactly once. Base UI instead expects
 * the labels declared up front on `Select.Root` via `items`, and renders the
 * bare value when they are missing — which is how the sprint picker came to
 * read "2" instead of "Rex Sprint 32 (active) (15 Jul – 28 Jul)".
 *
 * Reading them off the mounted items is not an option: the Select's portal only
 * exists while the menu is open, so the trigger would show raw values until the
 * user had opened the list once. So the labels are instead harvested from the
 * `<SelectContent>` children as React elements, which are describable without
 * being mounted, and the call sites keep writing plain `<SelectItem>`s.
 */
const SelectLabelsContext = React.createContext<Map<
  string,
  React.ReactNode
> | null>(null)

/**
 * Walk a `<SelectContent>`'s children and collect every `value` -> children
 * pair, descending through groups and fragments.
 */
function collectLabels(
  children: React.ReactNode,
  into: Map<string, React.ReactNode>
): Map<string, React.ReactNode> {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as {
      value?: unknown
      children?: React.ReactNode
    }
    if (child.type === SelectItem && typeof props.value === "string") {
      into.set(props.value, props.children)
      return
    }
    if (props.children !== undefined) collectLabels(props.children, into)
  })
  return into
}

/** Base UI reports the reason for a change; the app only wants the value. */
type RootProps = Omit<
  React.ComponentProps<typeof SelectPrimitive.Root<string>>,
  "onValueChange"
> & {
  onValueChange?: (value: string) => void
}

function Select({ onValueChange, children, ...props }: RootProps) {
  const labels = React.useMemo(
    () => collectLabels(children, new Map<string, React.ReactNode>()),
    [children]
  )

  return (
    <SelectLabelsContext.Provider value={labels}>
      <SelectPrimitive.Root
        data-slot="select"
        onValueChange={
          onValueChange ? (value) => onValueChange(value as string) : undefined
        }
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectLabelsContext.Provider>
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const labels = React.useContext(SelectLabelsContext)
  return (
    <SelectPrimitive.Value data-slot="select-value" {...props}>
      {(value: unknown) => {
        if (value === null || value === undefined) return null
        const label = labels?.get(String(value))
        // Falling back to the raw value keeps a select whose current value is
        // not in its own list — a stale saved sprint id, say — showing
        // something rather than going blank.
        return label ?? String(value)
      }}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] border border-field bg-input px-2.5 py-2 text-left text-sm text-ink outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="size-4 opacity-50" />}
      />
    </SelectPrimitive.Trigger>
  )
}

/**
 * The menu. Base UI splits Radix's `Content` into Positioner (placement) and
 * Popup (the box you can see), so this wraps all three levels to keep the
 * one-element `<SelectContent>` the call sites already use.
 *
 * `--available-height` caps the popup at whatever room the viewport has left,
 * the same job Radix's `--radix-select-content-available-height` did.
 */
function SelectContent({
  className,
  children,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & {
  align?: React.ComponentProps<typeof SelectPrimitive.Positioner>["align"]
  sideOffset?: React.ComponentProps<
    typeof SelectPrimitive.Positioner
  >["sideOffset"]
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        // Base UI defaults to laying the menu *over* the trigger with the
        // selected item on top of it, which is native-macOS behaviour but not
        // what this form has ever done — and it forces a scroll lock even when
        // the menu is short. A plain dropdown below the field, please.
        alignItemWithTrigger={false}
        className="z-50 outline-none"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "relative max-h-[var(--available-height)] min-w-[max(8rem,var(--anchor-width))] overflow-x-hidden rounded-[var(--radius-surface)] border border-rule bg-paper text-ink shadow-[var(--ds-shadow-overlay,0_8px_12px_rgba(9,30,66,0.15))] outline-none",
            // A short opacity fade on open, nothing on close. No slide, no
            // zoom: the menu is a sheet of paper laid on the form, and a
            // dropdown that springs or scales is the "web app" tell the rest
            // of this page spends its effort avoiding. Exits are subtler than
            // entrances, so the close is instant.
            "transition-opacity duration-100 ease-[--ease-form] data-[starting-style]:opacity-0",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="max-h-[var(--available-height)] overflow-y-auto p-1 scroll-my-1">
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // Base UI marks the active option `data-highlighted` where Radix used
        // `:focus`; the treatment (ink block, paper text) is unchanged.
        // 4px, one step inside the popup's 6px: a highlighted row that shared
        // the container's radius would sit corner-to-corner with it.
        "relative flex w-full cursor-default items-center gap-2 rounded-[var(--radius-control)] py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-brand-soft data-highlighted:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center text-brand"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-rule", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center bg-paper py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center bg-paper py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
