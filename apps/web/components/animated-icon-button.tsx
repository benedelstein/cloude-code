import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link, { type LinkProps } from "next/link";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnchorProps = Pick<ComponentPropsWithoutRef<"a">, "rel" | "target">;

type AnimatedIconButtonProps = Omit<ButtonProps, "asChild"> & {
  children: ReactNode;
  icon: ReactNode;
  href?: LinkProps["href"];
} & AnchorProps;

export function AnimatedIconButton({
  children,
  className,
  href,
  icon,
  rel,
  target,
  ...buttonProps
}: AnimatedIconButtonProps) {
  const buttonClassName = cn("group/action-button shrink-0 gap-0 shadow-none", className);
  const content = (
    <>
      {children}
      <span className="ml-0 flex w-0 overflow-hidden opacity-0 transition-[margin,width,opacity] duration-150 group-hover/action-button:ml-1.5 group-hover/action-button:w-4 group-hover/action-button:opacity-100">
        {icon}
      </span>
    </>
  );

  if (href) {
    return (
      <Button {...buttonProps} asChild className={buttonClassName}>
        <Link href={href} rel={rel} target={target}>
          {content}
        </Link>
      </Button>
    );
  }

  return (
    <Button {...buttonProps} className={buttonClassName}>
      {content}
    </Button>
  );
}
