import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          className={cn(
            "z-50 rounded-md bg-stone-800 px-3 py-1.5 text-xs text-stone-100 shadow-md",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-stone-800" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
