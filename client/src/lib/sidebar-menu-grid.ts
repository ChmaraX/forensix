export const SIDEBAR_MENU_GRID =
  "[&_[role=menuitem]]:pl-2 [&_[role=menuitem]]:pr-1.5 [&_[role=menuitem]]:gap-2 [&_[role=menuitemradio]]:pl-2 [&_[role=menuitemradio]]:pr-1.5 [&_[role=menuitemradio]]:gap-2";

export const SIDEBAR_MENU_POPUP = `min-w-[240px] -ml-1 w-[calc(var(--radix-dropdown-menu-trigger-width,var(--anchor-width))_+_10px)] ${SIDEBAR_MENU_GRID}`;
