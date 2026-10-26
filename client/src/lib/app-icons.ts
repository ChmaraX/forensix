/**
 * The app's own icons, from Untitled UI — the same set FF's components draw
 * through `untitleduiIcons` (see `FluidProvider icons` in app.tsx), so a
 * page icon and a component glyph share one stroke and one grid.
 *
 * Import by role, never by glyph name, so a page reads "the cookies icon",
 * not "Ticket01":
 *
 *   import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
 *   <InputField icon={SearchIcon} … />
 *
 * Every export is a plain Untitled UI component: it takes `size`,
 * `strokeWidth`, and `className`, renders inline SVG (nothing to fetch, so
 * the CSP is untouched), and is `aria-hidden` by default.
 */
import {
  Archive,
  ArrowNarrowDown,
  ArrowNarrowUp,
  ArrowUpRight,
  BookClosed,
  Bookmark,
  Briefcase01,
  Browser,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClockRewind,
  Database01,
  Download01,
  Eye,
  EyeOff,
  File04,
  FileCode01,
  FileDownload02,
  FilterLines,
  Film01,
  Fingerprint01,
  Folder,
  FolderCheck,
  Globe01,
  Image01,
  ImageX,
  Inbox01,
  Keyboard01,
  Key01,
  LayoutGrid01,
  Lightbulb02,
  Lock01,
  Monitor01,
  Moon01,
  MusicNote01,
  RefreshCcw01,
  Rows01,
  SearchMd,
  Sun,
  Table,
  Terminal,
  Ticket01,
  TrendUp01,
  User01,
  XClose,
} from "@untitledui/icons";

import type { IconComponent } from "@/lib/icon-context";

/** The icon contract every component slot accepts (FF's `IconComponent`). */
export type AppIcon = IconComponent;

/**
 * One icon per sidebar section, picked for what each record type *is*:
 * Top sites is ranking, Sites is host identity, Bookmarks the saved-page
 * glyph, Favicons the image glyph, so the four web-page sections read apart
 * at a glance.
 */
export const ARTIFACT_ICONS = {
  overview: LayoutGrid01,
  candidates: Lightbulb02,
  timeline: Rows01,
  sites: Globe01,
  history: ClockRewind,
  downloads: Download01,
  bookmarks: Bookmark,
  "top-sites": TrendUp01,
  cookies: Ticket01,
  credentials: Key01,
  autofill: ClipboardCheck,
  cache: Database01,
  favicons: Image01,
  metadata: Fingerprint01,
} as const satisfies Record<string, AppIcon>;

/* Actions and controls. */
export const SearchIcon: AppIcon = SearchMd;
export const RefreshIcon: AppIcon = RefreshCcw01;
export const ExternalLinkIcon: AppIcon = ArrowUpRight;
export const CloseIcon: AppIcon = XClose;
export const CalendarIcon: AppIcon = Calendar;
export const ChevronDownIcon: AppIcon = ChevronDown;
export const ChevronLeftIcon: AppIcon = ChevronLeft;
export const ChevronRightIcon: AppIcon = ChevronRight;
export const ShowIcon: AppIcon = Eye;
export const HideIcon: AppIcon = EyeOff;
/** Newest first / oldest first. */
export const SortNewestIcon: AppIcon = ArrowNarrowDown;
export const SortOldestIcon: AppIcon = ArrowNarrowUp;
/** A phone toolbar's "Filters (n)" button (`CompactFilters`). */
export const FilterIcon: AppIcon = FilterLines;
/** The ⌘K menu's Shortcuts rows. */
export const KeyboardIcon: AppIcon = Keyboard01;

/* Theme. */
export const LightThemeIcon: AppIcon = Sun;
export const SystemThemeIcon: AppIcon = Monitor01;
export const DarkThemeIcon: AppIcon = Moon01;

/* States and things. */
export const EmptyIcon: AppIcon = Inbox01;
export const LockedIcon: AppIcon = Lock01;
export const MissingImageIcon: AppIcon = ImageX;
export const BrowserIcon: AppIcon = Browser;
export const UserIcon: AppIcon = User01;
export const CaseIcon: AppIcon = Briefcase01;
export const FolderIcon: AppIcon = Folder;
export const OpenFolderIcon: AppIcon = FolderCheck;
export const LibraryIcon: AppIcon = BookClosed;
export const DownloadedFileIcon: AppIcon = FileDownload02;

/** File kinds (Downloads). */
export const FILE_KIND_ICONS = {
  archive: Archive,
  audio: MusicNote01,
  code: FileCode01,
  image: Image01,
  text: File04,
  video: Film01,
  sheet: Table,
  executable: Terminal,
} as const satisfies Record<string, AppIcon>;
