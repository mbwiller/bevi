import type * as React from 'react';

/** A Bev as the components read it (subset of the shared `Bev` type). */
export interface Bev {
  name: string;
  brand?: string;
  /** Omitted from lines when "Original". */
  flavor?: string;
  /** Category slug: 'soda' | 'diet_soda' | 'juice' | 'water' | 'sparkling_water' | 'energy' | 'coffee' | 'tea' | 'boba' | 'sports' | 'smoothie' | 'beer' | 'wine' | 'spirits_cocktails' | 'other' */
  category: CategoryId;
  priceTier: 1 | 2 | 3 | 4;
  priceEstimated?: boolean;
  /** Transparent cutout URL. */
  src?: string;
  /** Placeholder art when there is no photo yet. */
  art?: BevArtProps;
  photoStatus?: 'ready' | 'processing' | 'loading';
}
export type CategoryId = 'soda' | 'diet_soda' | 'juice' | 'water' | 'sparkling_water' | 'energy' | 'coffee' | 'tea' | 'boba' | 'sports' | 'smoothie' | 'beer' | 'wine' | 'spirits_cocktails' | 'other';
export type Bucket = 'loved' | 'fine' | 'disliked';
export interface Person { name: string; handle?: string; src?: string }

export interface WordmarkProps { height?: number; tone?: 'brand' | 'inverse' | 'mono'; title?: string; className?: string }
export declare function Wordmark(props: WordmarkProps): React.ReactElement;

export interface IconProps {
  /** Lucide name from the bundled subset; see `Bevi.iconNames`. */
  name: string; size?: number; strokeWidth?: number; filled?: boolean; title?: string; className?: string; style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): React.ReactElement | null;

export interface BevArtProps {
  kind?: 'can' | 'slimCan' | 'bottle' | 'waterBottle' | 'boba' | 'icedCup' | 'mug' | 'wine' | 'pint' | 'carton';
  /** Body or liquid colour (a product colour, not a token). */
  color?: string;
  /** Label, straw or band colour. */
  accent?: string;
  title?: string; className?: string;
}
export declare function BevArt(props: BevArtProps): React.ReactElement;

export interface BevImageProps { src?: string; art?: BevArtProps; alt?: string; size?: 40 | 56 | 96 | 155 | number; status?: 'ready' | 'processing' | 'loading'; className?: string }
export declare function BevImage(props: BevImageProps): React.ReactElement;

export interface ScoreBubbleProps {
  /** 0–10; colour follows the bucket band (≥ 7 high, ≥ 4 mid, else low). null shows the lock. */
  score?: number | null;
  /** 40 rows and posts, 56 Bev detail and the ranking result, 72 the ranking note step's score reveal. */
  size?: 40 | 56 | 72;
  variant?: 'default' | 'predicted' | 'locked';
  className?: string;
}
export declare function ScoreBubble(props: ScoreBubbleProps): React.ReactElement;

export interface PriceTierProps { tier: 1 | 2 | 3 | 4; estimated?: boolean; className?: string }
export declare function PriceTier(props: PriceTierProps): React.ReactElement;

export interface AvatarProps { name: string; src?: string; size?: 32 | 44 | 60 | 100; ring?: boolean; className?: string }
export declare function Avatar(props: AvatarProps): React.ReactElement;

export interface AvatarStackProps { people: Person[]; size?: number; max?: number; className?: string }
export declare function AvatarStack(props: AvatarStackProps): React.ReactElement;

export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'outlined'; icon?: string; iconRight?: string;
  /** Outlined only: selected state in `primaryTint`. */
  active?: boolean;
}
export declare function Pill(props: PillProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'outlined' | 'primary' | 'ghost';
  /** md = 36pt (default for outlined), lg = 52pt (default for primary). */
  size?: 'md' | 'lg';
  icon?: string; block?: boolean; loading?: boolean;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface IconButtonProps { icon: string; label: string; variant?: 'plain' | 'filled'; badge?: number | string; size?: number; onClick?: () => void; className?: string }
export declare function IconButton(props: IconButtonProps): React.ReactElement;

/** The post's heart: outline until liked, then filled `primary`, with the like count beside it (hidden at 0). Accessible name "Like" / "Unlike, 12 likes", `aria-pressed`. */
export interface LikeButtonProps { liked?: boolean; count?: number; onClick?: () => void; className?: string }
export declare function LikeButton(props: LikeButtonProps): React.ReactElement;

/** The post's comment control, beside the heart: `message-circle` outline in `text` with the comment count (hidden at 0). Accessible name "Comment" / "Comment, 3 comments". Opens the comments sheet. */
export interface CommentButtonProps { count?: number; onClick?: () => void; className?: string }
export declare function CommentButton(props: CommentButtonProps): React.ReactElement;

export interface FilterPillProps { count?: number; label?: string; icon?: string | null; chevron?: boolean; onClick?: () => void; className?: string }
export declare function FilterPill(props: FilterPillProps): React.ReactElement;

export interface SortToggleProps { label?: string; onClick: () => void; /** The search icon shows only when this is given. */ onSearch?: () => void; className?: string }
export declare function SortToggle(props: SortToggleProps): React.ReactElement;

export interface SearchBarProps { placeholder?: string; value?: string; onChange?: (v: string) => void; variant?: 'filled' | 'outlined'; autoFocus?: boolean; onClear?: () => void; /** The field took focus: the Search tab opens its results panel. */ onFocus?: () => void; id?: string; className?: string }
export declare function SearchBar(props: SearchBarProps): React.ReactElement;

export interface TextFieldProps { label?: string; value?: string; defaultValue?: string; placeholder?: string; prefix?: string; hint?: string; error?: string; type?: string; id?: string; onChange?: React.ChangeEventHandler<HTMLInputElement>; className?: string }
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface PriceTierPickerProps { value?: 1 | 2 | 3 | 4 | null; estimated?: boolean; onChange?: (tier: number | null, estimated: boolean) => void; className?: string }
export declare function PriceTierPicker(props: PriceTierPickerProps): React.ReactElement;

export interface HeaderAction { icon: string; label: string; badge?: number; onClick?: () => void; variant?: 'plain' | 'filled' }
export interface HeaderProps { title?: string; wordmark?: boolean; centered?: boolean; actions?: HeaderAction[]; onBack?: () => void; className?: string }
export declare function Header(props: HeaderProps): React.ReactElement;

export interface SectionHeaderProps { title: string; action?: string; actionLabel?: string; onAction?: () => void; className?: string }
export declare function SectionHeader(props: SectionHeaderProps): React.ReactElement;

export interface ListScopeDropdownProps { label?: string; onClick?: () => void; className?: string }
export declare function ListScopeDropdown(props: ListScopeDropdownProps): React.ReactElement;

export interface Tab { id: string; label: string; icon?: string; chevron?: boolean }
export interface SegmentedTabsProps { tabs: Tab[]; value?: string; onChange?: (id: string) => void; variant?: 'underline-text' | 'underline-icon'; accent?: 'text' | 'primary'; className?: string }
export declare function SegmentedTabs(props: SegmentedTabsProps): React.ReactElement;

export interface TabBarProps { active?: 'feed' | 'lists' | 'add' | 'leaderboard' | 'profile'; user?: Person; onChange?: (id: string) => void; safeArea?: boolean; className?: string }
export declare function TabBar(props: TabBarProps): React.ReactElement;

export interface BevRowProps {
  bev: Bev; number?: number; score?: number | null; scoreVariant?: 'default' | 'predicted' | 'locked';
  /** The Bev's rating count, printed as the meta line ("362 ratings") only when there is no `meta`; nothing at 0. */
  count?: number;
  /** Bottom-left line: "Ranked Oct 3", "Saved from @arjun", a recommendation reason. Wins over `count`. */
  meta?: React.ReactNode;
  saved?: boolean; actions?: boolean; showImage?: boolean; divider?: boolean;
  onRank?: () => void; onSave?: () => void; onClick?: () => void; className?: string;
}
export declare function BevRow(props: BevRowProps): React.ReactElement;

export interface FeedPostProps {
  actor?: Person; you?: boolean; bev: Bev; score?: number; scoreVariant?: 'default' | 'predicted' | 'locked';
  note?: string; time?: string; saved?: boolean; photos?: { src?: string; art?: BevArtProps }[];
  /** The viewer liked this post: the heart is filled `primary`. */
  liked?: boolean;
  /** Likes on the post, beside the heart; hidden at 0. */
  likeCount?: number;
  /** Toggles the like from the heart. A double-tap outside the photo strip calls it only when not yet liked. */
  onLike?: () => void;
  /** Comments on the post (the contract's first seven, oldest first), shown inline as "**handle** text" while `commentCount` ≤ 7. */
  comments?: PostComment[];
  /** All comments on the post: beside the comment icon (hidden at 0); above 7 the post shows "View all N comments" instead of the list. */
  commentCount?: number;
  /** Opens the comments sheet (the comment icon and "View all N comments"). */
  onComment?: () => void;
  onRank?: () => void; onSave?: () => void; onOpen?: () => void; divider?: boolean; className?: string;
}
export declare function FeedPost(props: FeedPostProps): React.ReactElement;

export interface FeaturedCardProps { title: string; subtitle?: string; src?: string; art?: BevArtProps; tint?: string; onClick?: () => void; className?: string }
export declare function FeaturedCard(props: FeaturedCardProps): React.ReactElement;

/** Bev of the day / Bev of the week on the Feed: a caps label, the Bev's 164pt tile, its name and the score it won with. Not a post. */
export interface BevOfCardProps {
  period?: 'day' | 'week'; bev: Bev;
  /** The Bayesian score it won with. */
  score?: number | null;
  /** Only when the winner is from an earlier period: "Oct 17" (day), "Week of Oct 12" (week). */
  date?: string;
  onClick?: () => void; className?: string;
}
export declare function BevOfCard(props: BevOfCardProps): React.ReactElement;

export interface ProfileListRowProps { icon: string; iconFilled?: boolean; label: string; count?: number; onClick?: () => void; divider?: boolean; className?: string }
export declare function ProfileListRow(props: ProfileListRowProps): React.ReactElement;

/** A 4pt track in `input` with a `primary` fill (a share you earned). Decorative (`aria-hidden`): the line beside it says the number. */
export interface ProgressBarProps { value: number; className?: string }
export declare function ProgressBar(props: ProgressBarProps): React.ReactElement;

/** Bev'd's progress line: "Soda · 4 of 61 tried · 6%" (rounded down; "<1%" once anything is tried) over a 4pt `primary` bar. With `onClick` it is a button that opens the CollectionSheet. */
export interface ProgressStripProps { label?: string; ranked: number; total: number; onClick?: () => void; className?: string }
export declare function ProgressStrip(props: ProgressStripProps): React.ReactElement;

export interface StatCardProps { icon: string; label: string; value: React.ReactNode; onClick?: () => void; className?: string }
export declare function StatCard(props: StatCardProps): React.ReactElement;

export interface UserRowProps { user: Person; rank?: number; meta?: string; streak?: number; following?: boolean; self?: boolean; onFollow?: () => void; onClick?: () => void; divider?: boolean; className?: string }
export declare function UserRow(props: UserRowProps): React.ReactElement;

/** Gut-check choice; selecting it pours the bucket colour in. Place on a BevGlow. */
export interface BucketButtonProps {
  bucket: Bucket; selected?: boolean;
  /** tint (default; always on the Bevi web app): 12% bucket tint and a 4px bucket bar. glass: liquid glass, only with the native GlassView on iOS 26+, never imitated with a blur. Reduce Transparency forces tint. */
  material?: 'glass' | 'tint';
  onClick?: () => void; className?: string;
}
export declare function BucketButton(props: BucketButtonProps): React.ReactElement;

/** Blurred colour field behind the gut-check BucketButtons: the Bev's colour plus `primary` and `fizz`. */
export interface BevGlowProps { color?: string; children?: React.ReactNode; className?: string; style?: React.CSSProperties }
export declare function BevGlow(props: BevGlowProps): React.ReactElement;

export interface CompareCardProps { bev: Bev; rankLabel?: string; isNew?: boolean; selected?: boolean; onClick?: () => void; className?: string }
export declare function CompareCard(props: CompareCardProps): React.ReactElement;

export interface ProgressDotsProps { total: number; current: number; className?: string }
export declare function ProgressDots(props: ProgressDotsProps): React.ReactElement;

export interface EmptyStateProps { icon?: string; title: string; body?: string; action?: string; onAction?: () => void; className?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export interface ErrorStateProps { title?: string; message?: string; icon?: string; onRetry?: () => void; className?: string }
export declare function ErrorState(props: ErrorStateProps): React.ReactElement;

export interface SkeletonProps { variant?: 'text' | 'block' | 'circle' | 'row' | 'post'; width?: number | string; height?: number; lines?: number; className?: string }
export declare function Skeleton(props: SkeletonProps): React.ReactElement;

export interface SheetProps { open?: boolean; title?: string; snap?: 40 | 90; onClose?: () => void; children?: React.ReactNode; className?: string }
export declare function Sheet(props: SheetProps): React.ReactElement | null;

/** One comment as the post and the sheet draw it. `time` is relative ("2 hours ago"); `mine` adds Delete in the sheet. */
export interface PostComment { id?: string; author: Person; body: string; time?: string; mine?: boolean }
/** The post's comments in a 90% Sheet, oldest at the top, newest above the composer; empty state "No comments yet"; composer "Add a comment…" + Post, 280-character limit (the count shows from 20 left). */
export interface CommentsSheetProps { open?: boolean; comments?: PostComment[]; me?: Person; onClose?: () => void; onPost?: (body: string) => void; onDelete?: (id: string) => void; error?: string; className?: string }
export declare function CommentsSheet(props: CommentsSheetProps): React.ReactElement | null;

/** One category's progress: the contract's `CategoryProgress`, as `stats.getCategoryProgress()` returns it. */
export interface CategoryProgressRow { categoryId: CategoryId; ranked: number; total: number }
/** "Your collection" in a 90% Sheet: one row per category with a total, in catalog order, "9 of 40" and a bar; a row calls `onSelect` with its category. */
export interface CollectionSheetProps { open?: boolean; rows?: CategoryProgressRow[]; onClose?: () => void; onSelect?: (categoryId: CategoryId) => void; className?: string }
export declare function CollectionSheet(props: CollectionSheetProps): React.ReactElement | null;

declare global {
  interface Window {
    Bevi: {
      Wordmark: typeof Wordmark; Icon: typeof Icon; BevArt: typeof BevArt; BevImage: typeof BevImage; ScoreBubble: typeof ScoreBubble;
      PriceTier: typeof PriceTier; Avatar: typeof Avatar; AvatarStack: typeof AvatarStack; Pill: typeof Pill; Button: typeof Button;
      IconButton: typeof IconButton; LikeButton: typeof LikeButton; CommentButton: typeof CommentButton; FilterPill: typeof FilterPill; SortToggle: typeof SortToggle; SearchBar: typeof SearchBar;
      TextField: typeof TextField; PriceTierPicker: typeof PriceTierPicker; Header: typeof Header; SectionHeader: typeof SectionHeader;
      ListScopeDropdown: typeof ListScopeDropdown; SegmentedTabs: typeof SegmentedTabs; TabBar: typeof TabBar; BevRow: typeof BevRow;
      FeedPost: typeof FeedPost; FeaturedCard: typeof FeaturedCard; BevOfCard: typeof BevOfCard; ProfileListRow: typeof ProfileListRow; StatCard: typeof StatCard;
      UserRow: typeof UserRow; ProgressStrip: typeof ProgressStrip; ProgressBar: typeof ProgressBar; BevGlow: typeof BevGlow; BucketButton: typeof BucketButton; CompareCard: typeof CompareCard; ProgressDots: typeof ProgressDots;
      EmptyState: typeof EmptyState; ErrorState: typeof ErrorState; Skeleton: typeof Skeleton; Sheet: typeof Sheet; CommentsSheet: typeof CommentsSheet; CollectionSheet: typeof CollectionSheet;
      /** The 15 category slugs with labels and icon names. */
      categories: { id: CategoryId; label: string; icon: string; isAlcoholic?: boolean }[];
      scoreBand(score: number): 'high' | 'mid' | 'low';
      formatScore(score: number): string;
      iconNames: string[];
      bevArtKinds: string[];
    };
  }
}
