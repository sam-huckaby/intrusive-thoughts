import { cn } from "../../lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn(
      "rounded-lg border border-stone-200 bg-white shadow-sm",
      className,
    )}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={cn("border-b border-stone-100 px-6 py-4", className)}>
      {children}
    </div>
  );
}

export function CardBody({ children, className }: CardProps) {
  return (
    <div className={cn("px-6 py-4", className)}>
      {children}
    </div>
  );
}
