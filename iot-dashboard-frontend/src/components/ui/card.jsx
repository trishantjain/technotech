import React from "react";
import { cn } from "../../lib/utils";

const Card = ({ className, ...props }) => (
  <div className={cn("v2-card", className)} {...props} />
);

const CardHeader = ({ className, ...props }) => (
  <div className={cn("v2-card-header", className)} {...props} />
);

const CardTitle = ({ className, children, ...props }) => (
  <h3 className={cn("v2-card-title", className)} {...props}>
    {children}
  </h3>
);

const CardContent = ({ className, ...props }) => (
  <div className={cn("v2-card-content", className)} {...props} />
);

export { Card, CardHeader, CardTitle, CardContent };
