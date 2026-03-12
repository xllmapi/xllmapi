import { cn } from "@/lib/utils";
import { type InputHTMLAttributes } from "react";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function FormInput({ label, className, id, ...props }: FormInputProps) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="text-text-secondary text-xs block mb-1.5">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          "w-full rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors",
          className,
        )}
        {...props}
      />
    </div>
  );
}
