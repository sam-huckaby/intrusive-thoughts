import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-stone-800 text-white hover:bg-stone-900 active:bg-stone-950",
  secondary: "bg-stone-100 text-stone-700 hover:bg-stone-200 active:bg-stone-300 border border-stone-200",
  ghost: "text-stone-600 hover:bg-stone-100 active:bg-stone-200",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

const BASE_CLASSES = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant = "primary", size = "md", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
        {...props}
      />
    );
  },
);
