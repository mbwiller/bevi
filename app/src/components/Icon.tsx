// One import per icon, not the barrel: Metro doesn't tree-shake, and the barrel is all ~1,900 icons.
import ArrowUpDown from 'lucide-react-native/icons/arrow-up-down';
import Banana from 'lucide-react-native/icons/banana';
import Beer from 'lucide-react-native/icons/beer';
import Bookmark from 'lucide-react-native/icons/bookmark';
import Camera from 'lucide-react-native/icons/camera';
import CandyOff from 'lucide-react-native/icons/candy-off';
import ChartNoAxesColumn from 'lucide-react-native/icons/chart-no-axes-column';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CirclePlus from 'lucide-react-native/icons/circle-plus';
import Citrus from 'lucide-react-native/icons/citrus';
import Clock from 'lucide-react-native/icons/clock';
import Coffee from 'lucide-react-native/icons/coffee';
import CupSoda from 'lucide-react-native/icons/cup-soda';
import Droplets from 'lucide-react-native/icons/droplets';
import Dumbbell from 'lucide-react-native/icons/dumbbell';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import FileText from 'lucide-react-native/icons/file-text';
import Flame from 'lucide-react-native/icons/flame';
import Frown from 'lucide-react-native/icons/face-slightly-frowning'; // Lucide renamed frown (the design system's name is kept)
import GlassWater from 'lucide-react-native/icons/glass-water';
import Globe from 'lucide-react-native/icons/globe';
import Heart from 'lucide-react-native/icons/heart';
import Image from 'lucide-react-native/icons/image';
import Laugh from 'lucide-react-native/icons/face-grinning'; // Lucide renamed laugh (the design system's name is kept)
import Leaf from 'lucide-react-native/icons/leaf';
import List from 'lucide-react-native/icons/list';
import ListFilter from 'lucide-react-native/icons/list-filter';
import Lock from 'lucide-react-native/icons/lock';
import MapIcon from 'lucide-react-native/icons/map'; // not `Map`, which would shadow the global
import Martini from 'lucide-react-native/icons/martini';
import Meh from 'lucide-react-native/icons/face-neutral'; // Lucide renamed meh (the design system's name is kept)
import Menu from 'lucide-react-native/icons/menu';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import Milk from 'lucide-react-native/icons/milk';
import Newspaper from 'lucide-react-native/icons/newspaper';
import Plus from 'lucide-react-native/icons/plus';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import Search from 'lucide-react-native/icons/search';
import Settings from 'lucide-react-native/icons/settings';
import Share from 'lucide-react-native/icons/share';
import Sparkles from 'lucide-react-native/icons/sparkles';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Trophy from 'lucide-react-native/icons/trophy';
import Undo2 from 'lucide-react-native/icons/undo-2';
import User from 'lucide-react-native/icons/user';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Users from 'lucide-react-native/icons/users';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import Wine from 'lucide-react-native/icons/wine';
import X from 'lucide-react-native/icons/x';
import Zap from 'lucide-react-native/icons/zap';
import type { LucideIcon } from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import { useTheme } from '@/theme';

/** The design system's icon subset (`Bevi.iconNames`), by Lucide kebab name. */
const ICONS = {
  newspaper: Newspaper,
  list: List,
  plus: Plus,
  trophy: Trophy,
  settings: Settings,
  share: Share,
  menu: Menu,
  search: Search,
  x: X,
  'user-plus': UserPlus,
  camera: Camera,
  users: Users,
  user: User,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  ellipsis: Ellipsis,
  bookmark: Bookmark,
  'circle-plus': CirclePlus,
  'circle-check': CircleCheck,
  heart: Heart,
  'message-circle': MessageCircle,
  'undo-2': Undo2,
  flame: Flame,
  lock: Lock,
  'arrow-up-down': ArrowUpDown,
  'list-filter': ListFilter,
  clock: Clock,
  image: Image,
  check: Check,
  'triangle-alert': TriangleAlert,
  'wifi-off': WifiOff,
  'refresh-cw': RefreshCw,
  'file-text': FileText,
  'chart-no-axes-column': ChartNoAxesColumn,
  sparkles: Sparkles,
  laugh: Laugh,
  meh: Meh,
  frown: Frown,
  'cup-soda': CupSoda,
  'candy-off': CandyOff,
  citrus: Citrus,
  'glass-water': GlassWater,
  droplets: Droplets,
  zap: Zap,
  coffee: Coffee,
  leaf: Leaf,
  milk: Milk,
  dumbbell: Dumbbell,
  banana: Banana,
  beer: Beer,
  wine: Wine,
  martini: Martini,
  globe: Globe,
  // The Search tab's map area.
  map: MapIcon,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export const iconNames = Object.keys(ICONS) as IconName[];

export interface IconProps {
  /** Lucide kebab name from the design system's subset (see `iconNames`). */
  name: IconName;
  /** 28 in headers and action rows, 24 in profile rows and stat cards, 16 inline in meta lines. */
  size?: number;
  /** 1.6–1.75 at 24–28, 2 at 16. */
  strokeWidth?: number;
  /** Fills the shape with the icon colour (a saved bookmark, an active heart). */
  filled?: boolean;
  /** Defaults to `text`; pass `primary` for active or saved, `textSecondary` for chevrons. */
  color?: string;
  /** Accessible name. Without it the icon is decorative and hidden from screen readers. */
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/** Lucide outline icon. Decorative unless it has a `title`. */
export function Icon({ name, size = 24, strokeWidth = 1.75, filled = false, color, title, style }: IconProps) {
  const { colors } = useTheme();
  const Glyph: LucideIcon | undefined = ICONS[name];
  if (!Glyph) return null;
  const tint = color ?? colors.text;
  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={!!title}
      accessibilityRole={title ? 'image' : undefined}
      accessibilityLabel={title}
      aria-hidden={title ? undefined : true}
      importantForAccessibility={title ? 'yes' : 'no-hide-descendants'}
      pointerEvents="none"
    >
      <Glyph size={size} color={tint} strokeWidth={strokeWidth} fill={filled ? tint : 'none'} />
    </View>
  );
}

export { CATEGORY_ICON, categoryIcon } from '@/lib/categories';
