"use client"

import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react"
import { Toaster as SonnerToaster, type ToasterProps } from "sonner"

const Sonner = ({ ...props }: ToasterProps) => {
  return (
    <SonnerToaster
      theme="light"
      position="top-right"
      closeButton={false}
      icons={{
        error: <CircleAlert className="h-4.5 w-4.5 text-danger" />,
        success: <CheckCircle2 className="h-4.5 w-4.5 text-success" />,
        warning: <TriangleAlert className="h-4.5 w-4.5 text-warning" />,
      }}
      {...props}
    />
  )
}

export { Sonner }
