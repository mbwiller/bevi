import { Wordmark, Icon, BevArt, categories, scoreBand, formatScore, iconNames, bevArtKinds } from './core.jsx';
import { BevImage, ScoreBubble, PriceTier, Avatar, AvatarStack, Pill, Button, IconButton, LikeButton, CommentButton, FilterPill, SortToggle, Skeleton } from './primitives.jsx';
import { Header, SectionHeader, ListScopeDropdown, BevRow, FeedPost, FeaturedCard, ProfileListRow, StatCard, UserRow } from './rows.jsx';
import { SegmentedTabs, TabBar, SearchBar, TextField, PriceTierPicker, BevGlow, BucketButton, CompareCard, ProgressDots, EmptyState, ErrorState, Sheet, CommentsSheet } from './flow.jsx';

// Order = catalogue order (mirrored in the @ds-bundle header by build.mjs).
export const COMPONENTS = {
  Wordmark, Icon, BevArt, BevImage, ScoreBubble, PriceTier, Avatar, AvatarStack,
  Pill, Button, IconButton, LikeButton, CommentButton, FilterPill, SortToggle, SearchBar, TextField, PriceTierPicker,
  Header, SectionHeader, ListScopeDropdown, SegmentedTabs, TabBar,
  BevRow, FeedPost, FeaturedCard, ProfileListRow, StatCard, UserRow,
  BevGlow, BucketButton, CompareCard, ProgressDots,
  EmptyState, ErrorState, Skeleton, Sheet, CommentsSheet,
};
const g = window;
g.Bevi = Object.assign(g.Bevi || {}, COMPONENTS, { categories, scoreBand, formatScore, iconNames, bevArtKinds });
