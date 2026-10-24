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
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowNarrowDown,
  ArrowNarrowUp,
  ArrowUp,
  ArrowUpRight,
  BookClosed,
  Bookmark,
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
  Film01,
  Fingerprint01,
  Folder,
  FolderCheck,
  Globe01,
  Globe02,
  Image01,
  ImageX,
  Inbox01,
  Key01,
  LayoutGrid01,
  Lock01,
  LockUnlocked01,
  Monitor01,
  Moon01,
  MusicNote01,
  RefreshCcw01,
  Rows01,
  SearchMd,
  ShieldTick,
  Sun,
  Table,
  Terminal,
  Ticket01,
  TrendUp01,
  User01,
  Users01,
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

export type ArtifactIconKey = keyof typeof ARTIFACT_ICONS;

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
export const ArrowDownIcon: AppIcon = ArrowDown;
export const ArrowUpIcon: AppIcon = ArrowUp;

/* Theme. */
export const LightThemeIcon: AppIcon = Sun;
export const SystemThemeIcon: AppIcon = Monitor01;
export const DarkThemeIcon: AppIcon = Moon01;

/* States and things. */
export const EmptyIcon: AppIcon = Inbox01;
export const WarningIcon: AppIcon = AlertTriangle;
export const LockedIcon: AppIcon = Lock01;
export const UnlockedIcon: AppIcon = LockUnlocked01;
export const VerifiedIcon: AppIcon = ShieldTick;
export const MissingImageIcon: AppIcon = ImageX;
export const BrowserIcon: AppIcon = Browser;
export const WebIcon: AppIcon = Globe02;
export const UserIcon: AppIcon = User01;
export const UsersIcon: AppIcon = Users01;
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
