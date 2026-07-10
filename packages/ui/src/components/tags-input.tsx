"use client";

import * as React from "react";
import { Check, Plus, X as RemoveIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";

export type TagsInputOption = {
  value: string;
  label?: string;
};

export interface TagsInputProps {
  value: string[];
  onValueChange: (next: string[]) => void;
  options?: TagsInputOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustomValues?: boolean;
  normalizeValue?: (raw: string) => string;
  /** Return `true` to accept the value, or an error string to reject it and show inline. */
  onValidate?: (value: string) => true | string;
  maxItems?: number;
  minItems?: number;
  disabled?: boolean;
  className?: string;
}

const PASTE_SPLITTER = /[\n#?=&\t,./-]+/;

export function TagsInput({
  value,
  onValueChange,
  options = [],
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results.",
  allowCustomValues = true,
  normalizeValue,
  onValidate,
  maxItems,
  minItems = 0,
  disabled,
  className,
}: TagsInputProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [validationError, setValidationError] = React.useState("");

  const max = maxItems ?? Number.POSITIVE_INFINITY;
  const atMax = value.length >= max;
  const canRemove = !disabled && value.length > minItems;

  const selectedSet = React.useMemo(() => new Set(value), [value]);

  const normalize = (raw: string) => (normalizeValue ? normalizeValue(raw) : raw).trim();

  const filteredOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => (o.label ?? o.value).toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const candidate = normalize(query);
  const candidateIsNew =
    candidate.length > 0 &&
    !selectedSet.has(candidate) &&
    !options.some((o) => o.value === candidate);
  const showCreate = allowCustomValues && !disabled && !atMax && candidateIsNew;

  function validate(val: string): boolean {
    if (!onValidate) return true;
    const result = onValidate(val);
    if (result === true) {
      setValidationError("");
      return true;
    }
    setValidationError(result);
    return false;
  }

  function add(raw: string) {
    const val = normalize(raw);
    if (!val || selectedSet.has(val) || value.length >= max) return;
    if (!validate(val)) return;
    onValueChange([...value, val]);
  }

  function addMany(rawValues: string[]) {
    const next = [...value];
    const seen = new Set(next);
    for (const raw of rawValues) {
      if (next.length >= max) break;
      const val = normalize(raw);
      if (!val || seen.has(val)) continue;
      if (onValidate && onValidate(val) !== true) continue;
      next.push(val);
      seen.add(val);
    }
    if (next.length !== value.length) onValueChange(next);
  }

  function toggle(val: string) {
    if (selectedSet.has(val)) {
      if (canRemove) onValueChange(value.filter((v) => v !== val));
    } else {
      add(val);
    }
  }

  function remove(val: string) {
    if (canRemove && selectedSet.has(val)) {
      onValueChange(value.filter((v) => v !== val));
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (disabled) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setValidationError("");
    }
  }

  function handleCreate() {
    add(candidate);
    setQuery("");
  }

  const hasQuery = query.trim().length > 0;
  const showEmpty = hasQuery && !showCreate && filteredOptions.length === 0;
  const showHint = !hasQuery && options.length === 0 && allowCustomValues;

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <div
            role="combobox"
            aria-expanded={open}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            onClick={() => !disabled && setOpen(true)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className={cn(
              "border-input focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-9 w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 min-h-[22px]">
              {value.length === 0 ? (
                <span className="text-muted-foreground text-xs">{placeholder}</span>
              ) : (
                value.map((v) => (
                  <Badge key={v} variant="secondary" className={cn("gap-1", canRemove && "pr-1")}>
                    <span className="max-w-[14rem] truncate">{v}</span>
                    {canRemove && (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Remove ${v}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(v);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                      >
                        <RemoveIcon className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))
              )}
            </span>
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                if (validationError) setValidationError("");
              }}
              placeholder={atMax ? "Maximum reached" : searchPlaceholder}
              disabled={disabled || atMax}
              onKeyDown={(e) => {
                if (e.key === "Enter" && showCreate) {
                  e.preventDefault();
                  handleCreate();
                }
                if (e.key === "Backspace" && query === "" && value.length > 0 && canRemove) {
                  e.preventDefault();
                  onValueChange(value.slice(0, -1));
                }
              }}
              onPaste={(e) => {
                if (disabled || atMax) return;
                const text = e.clipboardData.getData("text");
                if (!PASTE_SPLITTER.test(text)) return;
                e.preventDefault();
                addMany(text.split(PASTE_SPLITTER));
                setQuery("");
              }}
            />
            <CommandList>
              {showEmpty && (
                <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
              )}
              {showHint && (
                <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Type to add a value
                </div>
              )}
              {(showCreate || filteredOptions.length > 0) && (
                <CommandGroup>
                  {showCreate && (
                    <CommandItem value={`__create__:${candidate}`} onSelect={handleCreate}>
                      <Plus className="size-4 opacity-60" />
                      <span className="truncate">
                        Add <span className="font-medium">&ldquo;{candidate}&rdquo;</span>
                      </span>
                    </CommandItem>
                  )}
                  {filteredOptions.map((opt) => {
                    const isSelected = selectedSet.has(opt.value);
                    return (
                      <CommandItem key={opt.value} value={opt.value} onSelect={() => toggle(opt.value)}>
                        <Check className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")} />
                        <span className="truncate">{opt.label ?? opt.value}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
            {validationError && (
              <div className="border-t px-3 py-2 text-xs text-destructive">{validationError}</div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
