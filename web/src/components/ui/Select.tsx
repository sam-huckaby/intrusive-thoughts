import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "../../lib/utils";

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
}

export function Select({ value, onValueChange, options, placeholder, className }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} placeholder={placeholder} />
      <SelectContent options={options} />
    </SelectPrimitive.Root>
  );
}

function SelectTrigger({ className, placeholder }: { className?: string; placeholder?: string }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm",
        "placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <SelectPrimitive.Value placeholder={placeholder ?? "Select..."} />
      <SelectPrimitive.Icon>
        <ChevronIcon />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ options }: { options: Array<{ value: string; label: string }> }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className="z-50 overflow-hidden rounded-md border border-stone-200 bg-white shadow-md animate-in fade-in-0 zoom-in-95"
        position="popper"
        sideOffset={4}
      >
        <SelectPrimitive.Viewport className="p-1">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-3 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-stone-100 data-[highlighted]:text-stone-900",
        "data-[state=checked]:font-medium",
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-2 opacity-50">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
