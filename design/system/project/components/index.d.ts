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
  /** The Bev's Bayesian score on Bevi (the contract's `BevSummary.bayesScore`); a FeedPost prints it under the note. */
  bayesScore?: number | null;
  /** How many people have ranked it (`BevSummary.ratingCount`). */
  ratingCount?: number;
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

export interface AvatarProps { name: string; src?: string; size?: 24 | 32 | 44 | 60 | 100; ring?: boolean; className?: string }
export declare function Avatar(props: AvatarProps): React.ReactElement;

export interface AvatarStackProps { people: Person[]; size?: number; max?: number; className?: string }
export declare function AvatarStack(props: AvatarStackProps): React.ReactElement;

export interface AvatarPickerProps {
  name: string; src?: string;
  /** The picture is uploading: a spinner over the circle, both buttons disabled. */
  busy?: boolean;
  /** Why the last upload failed, as a `scoreLow` caption. */
  error?: string;
  /** "Add a photo" / "Change photo": opens the photo picker. */
  onChange?: () => void;
  /** "Remove": back to initials. Only shown with a photo. */
  onRemove?: () => void;
  className?: string;
}
export declare function AvatarPicker(props: AvatarPickerProps): React.ReactElement;

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

export interface SearchBarProps { placeholder?: string; value?: string; onChange?: (v: string) => void; variant?: 'filled' | 'outlined'; autoFocus?: boolean; onClear?: () => void; /** The field took focus, where that changes the screen. */ onFocus?: () => void; id?: string; className?: string }
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

/** The five tabs, left to right: Feed, Lists, Add Bev (the raised `primary` circle), Map, Profile. */
export type TabId = 'feed' | 'lists' | 'add' | 'map' | 'profile';
export interface TabBarProps { active?: TabId; user?: Person; onChange?: (id: TabId) => void; safeArea?: boolean; className?: string }
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
  note?: string;
  /** "5 hours ago", "Wednesday": printed after the brand in the meta line under the sentence. */
  time?: string;
  saved?: boolean;
  /** The ranker's own photos, as a scrolling strip with the note under it. Omit for the Bev's own picture beside the note; [] draws no picture. */
  photos?: { src?: string; art?: BevArtProps }[];
  /** People the viewer follows who ranked this Bev too (not the author, not the viewer): the first two show as Avatars 24 and bold first names. Empty or omitted: no line. */
  alsoBevdBy?: Person[];
  /** How many such people there are in all; past the two shown it reads "and 3 others". Defaults to `alsoBevdBy.length`. */
  alsoBevdCount?: number;
  /** The viewer liked this post: the heart is filled `primary`. */
  liked?: boolean;
  /** Likes on the post, beside the heart; hidden at 0. */
  likeCount?: number;
  /** Toggles the like from the heart. A double-tap outside the picture calls it only when not yet liked. Without it the post has no heart and no double-tap. */
  onLike?: () => void;
  /** Comments on the post (the contract's first seven, oldest first), shown inline as "**handle** text" while `commentCount` ≤ 7. */
  comments?: PostComment[];
  /** All comments on the post: beside the comment icon (hidden at 0); above 7 the post shows "View all N comments" instead of the list. */
  commentCount?: number;
  /** Opens the comments sheet (the comment icon and "View all N comments"). Without it the post has no comment icon. */
  onComment?: () => void;
  /** The viewer follows the author: the Follow pill is outlined "Following". */
  following?: boolean;
  /** Shows the author's Follow pill (UserRow's) at the start of the action row, where the heart sits on a feed post. Explore only. */
  onFollow?: () => void;
  /** Without `onRank` / `onSave` the post has no Rank it / Want to Try action. */
  onRank?: () => void; onSave?: () => void; onOpen?: () => void; divider?: boolean; className?: string;
}
export declare function FeedPost(props: FeedPostProps): React.ReactElement;

export interface FeaturedCardProps { title: string; subtitle?: string; src?: string; art?: BevArtProps; tint?: string; onClick?: () => void; className?: string }
export declare function FeaturedCard(props: FeaturedCardProps): React.ReactElement;

/** Bev of the day / Bev of the week on the Feed: half of a pair, a caps label, the Bev's square tile (it follows the card's width), its name and the score it won with. Not a post. */
export interface BevOfCardProps {
  /** `both`: the same Bev won the day and the week, so the Feed shows this one card ("Bev of the day and week") at the width one of the pair has. */
  period?: 'day' | 'week' | 'both'; bev: Bev;
  /** The Bayesian score it won with. */
  score?: number | null;
  /** Only when the winner is from an earlier period: "Oct 17" (day), "Week of Oct 12" (week). */
  date?: string;
  onClick?: () => void; className?: string;
}
export declare function BevOfCard(props: BevOfCardProps): React.ReactElement;

export interface ProfileListRowProps { icon: string; iconFilled?: boolean; label: string; count?: number; onClick?: () => void; divider?: boolean; className?: string }
export declare function ProfileListRow(props: ProfileListRowProps): React.ReactElement;

/** A 4pt track in `input` with a `primary` fill (a share you earned). `tone` recolours the fill with a score band (TasteBar). Decorative (`aria-hidden`): the line beside it says the number. */
export interface ProgressBarProps { value: number; tone?: 'primary' | 'scoreHigh' | 'scoreMid' | 'scoreLow'; className?: string }
export declare function ProgressBar(props: ProgressBarProps): React.ReactElement;

/** Bev'd's progress line: "Soda · 4 of 61 tried · 6%" (rounded down; "<1%" once anything is tried) over a 4pt `primary` bar. With `onClick` it is a button that opens the CollectionSheet. */
export interface ProgressStripProps { label?: string; ranked: number; total: number; onClick?: () => void; className?: string }
export declare function ProgressStrip(props: ProgressStripProps): React.ReactElement;

/** One category of a Taste Profile: icon and label, "8.1 · 9 ranked" with the score in its band colour, and a 4pt bar filled to `mean` / 10 in that colour. Not interactive; it reads "Coffee, average 8.1, 9 ranked". */
export interface TasteBarProps { categoryId: CategoryId; mean: number; rankingCount: number; className?: string }
export declare function TasteBar(props: TasteBarProps): React.ReactElement;

/** The Taste Profile tab's block: the one-line `readout` (omit or null to hide it) over a TasteBar per row. The app sorts the rows (mean, high to low) and writes the read-out; empty `rows` render nothing. */
export interface TasteProfileProps { rows: { categoryId: CategoryId; mean: number; rankingCount: number }[]; readout?: string | null; className?: string }
export declare function TasteProfile(props: TasteProfileProps): React.ReactElement | null;

export interface StatCardProps { icon: string; label: string; value: React.ReactNode; onClick?: () => void; className?: string }
export declare function StatCard(props: StatCardProps): React.ReactElement;

export interface UserRowProps {
  user: Person; rank?: number; meta?: string; streak?: number;
  /** A third line under the handle, with a 14pt `users` icon: "Followed by Sam and Arjun". The row is 72pt with it, 64pt without. */
  context?: string;
  following?: boolean; self?: boolean; onFollow?: () => void; onClick?: () => void; divider?: boolean; className?: string;
}
export declare function UserRow(props: UserRowProps): React.ReactElement;

/** Gut-check choice: a `primary` ring filled to a level (loved full, fine half, disliked empty) over its label. */
export interface BucketButtonProps {
  bucket: Bucket; selected?: boolean;
  /** Another bucket is chosen: the ring fades and the label goes `textSecondary`. */
  dimmed?: boolean;
  onClick?: () => void; className?: string;
}
export declare function BucketButton(props: BucketButtonProps): React.ReactElement;

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

/** The Map tab's art: a round minimap, dark until walked, with a lit path from you to the nearest Bev. One picture, not a live map. */
export interface FindBevArtProps { size?: number; title?: string; className?: string }
export declare function FindBevArt(props: FindBevArtProps): React.ReactElement;

/** A venue as the map components read it (the contract's `Venue`, the fields they show). */
export interface MapVenue { name: string; kind: 'chain' | 'craft'; neighborhood?: string | null; borough?: string | null; address?: string | null; website?: string | null }

/** A venue's pin on the map: white callout, grape circle with the kind's glyph, the score in bold. */
export interface MapCalloutProps {
  /** The best Bayesian score of what the venue sells, else the predicted one; null or omitted shows "–". */
  score?: number | null;
  /** Dotted ring and "~": the score is a prediction (only when no Bev there has a Bayesian score). */
  predicted?: boolean;
  /** chain = `store`, craft = `coffee`. */
  kind?: 'chain' | 'craft';
  /** Overrides the kind's glyph (reserved for the category icon of the venue's best Bev). */
  icon?: string;
  /** Raised and 1.15× larger, with a `primary` rim. */
  selected?: boolean;
  /** Reserved slot at the top right (↗ trending, bookmark) for when the contract has them. */
  badge?: React.ReactNode;
  /** Accessible name; defaults to "Craft, score 8.2". The app puts the venue's name first. */
  label?: string;
  onClick?: () => void; className?: string;
}
export declare function MapCallout(props: MapCalloutProps): React.ReactElement;

/** The filters over the map, scrolling sideways. Each facet takes the label of what is picked ('' for nothing). */
export interface MapFilterRowProps {
  /** Active filters, for "Filters N". */
  count?: number;
  /** false leaves the Neighborhood pill out (no vocabulary yet). */
  neighborhoods?: boolean;
  neighborhood?: string; category?: string; price?: string; retailer?: string; openNow?: boolean;
  onFilters?: () => void; onNeighborhood?: () => void; onCategory?: () => void; onPrice?: () => void; onRetailer?: () => void; onOpenNow?: () => void;
  className?: string;
}
export declare function MapFilterRow(props: MapFilterRowProps): React.ReactElement;

/** The map's floating controls: inline (filters; open the full map, View List) or `expanded` (List | Map, close, filters; locate, View List). */
export interface MapControlsProps {
  expanded?: boolean;
  mode?: 'map' | 'list';
  onModeChange?: (mode: 'map' | 'list') => void;
  onExpand?: () => void; onClose?: () => void; onLocate?: () => void;
  /** The blue dot is showing: the locate arrow turns `primary`. */
  located?: boolean;
  locating?: boolean;
  onViewList?: () => void;
  /** The MapFilterRow, under the top bar. */
  children?: React.ReactNode;
  className?: string;
}
export declare function MapControls(props: MapControlsProps): React.ReactElement;

/** A venue in the map's List view. */
export interface VenueRowProps { venue: MapVenue; openNow?: boolean | null; score?: number | null; predicted?: boolean; bevs?: number; divider?: boolean; onClick?: () => void; className?: string }
export declare function VenueRow(props: VenueRowProps): React.ReactElement;

/** One Bev in a VenueSheet: your score if you ranked it, else predicted, else the Bayesian score. */
export interface VenueBev { bev: Bev; score?: number | null; scoreVariant?: 'default' | 'predicted' | 'locked'; meta?: React.ReactNode; count?: number; saved?: boolean }
/** The tapped venue, docked under the full-screen map. */
export interface VenueSheetProps {
  venue?: MapVenue;
  openNow?: boolean | null;
  bevs?: VenueBev[];
  /** "Bevs here (N)": the pin's count while the rows load. */
  bevCount?: number;
  loading?: boolean;
  /** "This spot isn't here anymore". */
  notFound?: boolean;
  /** Another failure's title: an ErrorState with Retry. */
  error?: string;
  onClose?: () => void; onRetry?: () => void;
  onRank?: (row: VenueBev) => void; onSave?: (row: VenueBev) => void; onOpenBev?: (row: VenueBev) => void; onWebsite?: () => void;
  className?: string;
}
export declare function VenueSheet(props: VenueSheetProps): React.ReactElement;

declare global {
  interface Window {
    Bevi: {
      Wordmark: typeof Wordmark; Icon: typeof Icon; BevArt: typeof BevArt; BevImage: typeof BevImage; ScoreBubble: typeof ScoreBubble;
      PriceTier: typeof PriceTier; Avatar: typeof Avatar; AvatarStack: typeof AvatarStack; Pill: typeof Pill; Button: typeof Button;
      IconButton: typeof IconButton; LikeButton: typeof LikeButton; CommentButton: typeof CommentButton; FilterPill: typeof FilterPill; SortToggle: typeof SortToggle; SearchBar: typeof SearchBar;
      TextField: typeof TextField; PriceTierPicker: typeof PriceTierPicker; Header: typeof Header; SectionHeader: typeof SectionHeader;
      ListScopeDropdown: typeof ListScopeDropdown; SegmentedTabs: typeof SegmentedTabs; TabBar: typeof TabBar; BevRow: typeof BevRow;
      FeedPost: typeof FeedPost; FeaturedCard: typeof FeaturedCard; BevOfCard: typeof BevOfCard; ProfileListRow: typeof ProfileListRow; StatCard: typeof StatCard;
      UserRow: typeof UserRow; ProgressStrip: typeof ProgressStrip; ProgressBar: typeof ProgressBar; TasteBar: typeof TasteBar; TasteProfile: typeof TasteProfile; BucketButton: typeof BucketButton; CompareCard: typeof CompareCard; ProgressDots: typeof ProgressDots;
      EmptyState: typeof EmptyState; ErrorState: typeof ErrorState; Skeleton: typeof Skeleton; Sheet: typeof Sheet; CommentsSheet: typeof CommentsSheet; CollectionSheet: typeof CollectionSheet;
      FindBevArt: typeof FindBevArt; MapCallout: typeof MapCallout; MapFilterRow: typeof MapFilterRow; MapControls: typeof MapControls; VenueRow: typeof VenueRow; VenueSheet: typeof VenueSheet;
      /** The 15 category slugs with labels and icon names. */
      categories: { id: CategoryId; label: string; icon: string; isAlcoholic?: boolean }[];
      scoreBand(score: number): 'high' | 'mid' | 'low';
      formatScore(score: number): string;
      iconNames: string[];
      bevArtKinds: string[];
    };
  }
}
