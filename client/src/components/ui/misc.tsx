/**
 * Skeleton — FF's (shadcn) Skeleton, hidden from assistive tech. A loading
 * block announces itself once, on its own `role="status"` wrapper with an
 * `aria-label` (see `LoadingRows` in list-states), so each placeholder bar
 * stays silent.
 */
import type { ComponentProps } from "react";

import { Skeleton as FluidSkeleton } from "@/components/ui/skeleton";

export function Skeleton(props: ComponentProps<typeof FluidSkeleton>) {
  return <FluidSkeleton aria-hidden="true" {...props} />;
}
