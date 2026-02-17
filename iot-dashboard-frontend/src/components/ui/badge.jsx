import { cn } from "../../lib/utils";

const VARIANT_CLASS = {
  default: "v2-badge-default",
  success: "v2-badge-success",
  warning: "v2-badge-warning",
  danger: "v2-badge-danger",
};

const badgeVariants = ({ variant = "default" } = {}) => cn("v2-badge", VARIANT_CLASS[variant] || VARIANT_CLASS.default);

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
