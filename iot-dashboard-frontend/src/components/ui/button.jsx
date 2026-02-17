import React from "react";
import { cn } from "../../lib/utils";

const VARIANT_CLASS = {
  default: "v2-btn-default",
  secondary: "v2-btn-secondary",
  ghost: "v2-btn-ghost",
};

const SIZE_CLASS = {
  default: "v2-btn-md",
  sm: "v2-btn-sm",
};

const buttonVariants = ({ variant = "default", size = "default", className = "" } = {}) =>
  cn("v2-btn", VARIANT_CLASS[variant] || VARIANT_CLASS.default, SIZE_CLASS[size] || SIZE_CLASS.default, className);

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => (
  <button className={buttonVariants({ variant, size, className })} ref={ref} {...props} />
));

Button.displayName = "Button";

export { Button, buttonVariants };
