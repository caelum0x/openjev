import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] placeholder:text-subtle",
      "transition-[box-shadow] duration-150 ease-out",
      "focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]",
      "disabled:opacity-40",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-40 w-full resize-y rounded-md bg-inset px-3 py-3 text-sm leading-relaxed text-fg shadow-[var(--shadow-border)] placeholder:text-subtle",
      "transition-[box-shadow] duration-150 ease-out",
      "focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]",
      "disabled:opacity-40",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
