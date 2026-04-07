"use client"

import * as React from "react"
import { ChevronLeft } from "lucide-react"

import { cn } from "@/lib/utils"

type BackButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string
}

const BackButton = React.forwardRef<HTMLButtonElement, BackButtonProps>(
  ({ className, label = "Go back", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md p-2 text-foreground-muted transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:bg-muted focus-visible:text-foreground disabled:pointer-events-none",
        className
      )}
      aria-label={label}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </button>
  )
)

BackButton.displayName = "BackButton"

export { BackButton }
