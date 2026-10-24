/**
 * Build-time stand-in for `next/link`.
 *
 * Fluid Functionalism's Card is written for Next.js and imports `next/link`
 * for its `href` overlay. This dashboard is a single-file IIFE bundle with no
 * router, so `next/link` is aliased here (tsconfig `paths` + esbuild `alias`)
 * and renders a plain anchor. Keeping the alias in the build instead of
 * editing the installed component keeps `card.tsx` byte-faithful to the
 * registry, so a later `shadcn add --overwrite` needs no re-patching.
 */
import { forwardRef, type AnchorHTMLAttributes } from "react";

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(props, ref) {
    return <a ref={ref} {...props} />;
  },
);

export default Link;
