import React from 'react';
import { cx, Icon, BevArt, scoreBand, formatScore, formatCount, initialsOf } from './core.jsx';

/** Beli's score mark: a `surface` circle with a 2pt ring and the score in its bucket colour. */
export function ScoreBubble({ score, size = 40, variant = 'default', className }) {
  const band = scoreBand(score);
  const locked = variant === 'locked' || score == null;
  const predicted = variant === 'predicted';
  const label = locked
    ? 'Score hidden'
    : (predicted ? 'Predicted score ' : 'Score ') + formatScore(score);
  return (
    <span
      className={cx('bv', 'bv-score', 'bv-score-' + size, predicted && 'bv-score-predicted', locked && 'bv-score-locked', !locked && 'bv-band-' + band, className)}
      role="img"
      aria-label={label}
    >
      {locked ? (
        <Icon name="lock" size={size >= 72 ? 28 : size >= 56 ? 22 : 18} strokeWidth={2} />
      ) : (
        <span className="bv-score-num">{(predicted ? '~' : '') + formatScore(score)}</span>
      )}
    </span>
  );
}

/** Price tier as Beli prints it in a meta line: just the active count of $; "~" when estimated. */
export function PriceTier({ tier = 1, estimated = false, className }) {
  const s = '$'.repeat(Math.max(1, Math.min(4, tier)));
  return (
    <span className={cx('bv', 'bv-price', className)} aria-label={(estimated ? 'about ' : '') + s + (estimated ? ', estimated' : '')}>
      {(estimated ? '~' : '') + s}
    </span>
  );
}

/** Circle with initials on `avatarFill`, or a photo. Sizes 32 (tab bar), 44, 60 (posts), 100 (profile). */
export function Avatar({ name = '', src, size = 44, className, ring = false }) {
  return (
    <span className={cx('bv', 'bv-avatar', 'bv-avatar-' + size, ring && 'bv-avatar-ring', className)} style={{ width: size, height: size }} role="img" aria-label={name}>
      {src ? <img src={src} alt="" /> : <span className="bv-avatar-initials">{initialsOf(name)}</span>}
    </span>
  );
}

/** Overlapping Avatars ("Friends who've had it"), with a +N chip past `max`. */
export function AvatarStack({ people = [], size = 32, max = 4, className }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cx('bv', 'bv-avatar-stack', className)} aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p, i) => <Avatar key={i} name={p.name} src={p.src} size={size} ring />)}
      {rest > 0 ? <span className="bv-avatar-more" style={{ height: size, minWidth: size }}>+{rest}</span> : null}
    </span>
  );
}

/** Square Bev tile: a transparent cutout centred with 8% padding on a soft tint of `input`. */
export function BevImage({ src, art, alt = '', size = 56, status = 'ready', className }) {
  const r = size <= 40 ? 10 : size <= 56 ? 12 : 14;
  return (
    <span
      className={cx('bv', 'bv-bevimg', status === 'processing' && 'bv-bevimg-processing', status === 'loading' && 'bv-bevimg-loading', className)}
      style={{ width: size, height: size, borderRadius: r, padding: Math.round(size * 0.08) }}
      role="img"
      aria-label={alt + (status === 'processing' ? ' (photo processing)' : '')}
    >
      {status === 'loading' ? null : src ? <img src={src} alt="" /> : art ? <BevArt {...art} /> : <Icon name="image" size={Math.round(size * 0.36)} />}
    </span>
  );
}

/** Rounded pill, 30pt tall: filled (`primary`) for actions, outlined for options. Hit area extends to 44pt. */
export function Pill({ variant = 'outlined', icon, iconRight, children, active = false, onClick, className, type = 'button', ...rest }) {
  return (
    <button type={type} onClick={onClick} className={cx('bv', 'bv-pill', 'bv-pill-' + variant, active && 'bv-pill-active', className)} aria-pressed={variant === 'outlined' && active ? true : undefined} {...rest}>
      {icon ? <Icon name={icon} size={18} strokeWidth={2} /> : null}
      <span>{children}</span>
      {iconRight ? <Icon name={iconRight} size={16} strokeWidth={2} /> : null}
    </button>
  );
}

/** Rectangular button: `outlined` 36pt (profile row), `primary` 52pt for a screen's main action. */
export function Button({ variant = 'outlined', size, icon, children, block = false, loading = false, disabled = false, onClick, className, type = 'button', ...rest }) {
  const sz = size || (variant === 'primary' ? 'lg' : 'md');
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('bv', 'bv-btn', 'bv-btn-' + variant, 'bv-btn-' + sz, block && 'bv-btn-block', className)}
      {...rest}
    >
      {loading ? <span className="bv-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={sz === 'lg' ? 22 : 18} strokeWidth={2} /> : null}
      {children != null ? <span>{loading ? 'Working…' : children}</span> : null}
    </button>
  );
}

/** A bare 28pt outline icon with a 44pt target (`plain`), or the grey 32pt close circle (`filled`). */
export function IconButton({ icon, label, variant = 'plain', badge, onClick, className, size = 28 }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cx('bv', 'bv-iconbtn', 'bv-iconbtn-' + variant, className)}>
      {variant === 'filled' ? <span className="bv-iconbtn-disc"><Icon name={icon} size={18} strokeWidth={2.25} /></span> : <Icon name={icon} size={size} strokeWidth={1.6} />}
      {badge ? <span className="bv-iconbtn-badge">{badge}</span> : null}
    </button>
  );
}

/**
 * The post's like control: a 28pt heart, outline until liked, then filled `primary`; the count beside it ("12", "5k"), hidden at 0.
 * A press pops the heart (transform only).
 */
export function LikeButton({ liked = false, count = 0, onClick, className }) {
  const [pop, setPop] = React.useState(0);
  const label = (liked ? 'Unlike' : 'Like') + (count > 0 ? ', ' + count + (count === 1 ? ' like' : ' likes') : '');
  return (
    <button
      type="button"
      className={cx('bv', 'bv-like', liked && 'bv-liked', className)}
      aria-pressed={liked}
      aria-label={label}
      onClick={() => { setPop((n) => n + 1); if (onClick) onClick(); }}
    >
      <span key={pop} className={cx('bv-like-heart', pop > 0 && 'bv-like-pop')}>
        <Icon name="heart" size={28} strokeWidth={1.6} filled={liked} />
      </span>
      {count > 0 ? <span className="body bv-like-count" aria-hidden="true">{formatCount(count)}</span> : null}
    </button>
  );
}

/**
 * The post's comment control, beside the heart: a 28pt `message-circle` outline in `text` and the comment count ("3", "5k"), hidden at 0.
 * It opens the comments sheet. It has no on state, so it never turns grape.
 */
export function CommentButton({ count = 0, onClick, className }) {
  const label = 'Comment' + (count > 0 ? ', ' + count + (count === 1 ? ' comment' : ' comments') : '');
  return (
    <button type="button" className={cx('bv', 'bv-like', 'bv-comment', className)} aria-label={label} onClick={onClick}>
      <span className="bv-like-heart"><Icon name="message-circle" size={28} strokeWidth={1.6} /></span>
      {count > 0 ? <span className="body bv-like-count" aria-hidden="true">{formatCount(count)}</span> : null}
    </button>
  );
}

/** Outlined pill that opens filters; shows a `primary` count badge and turns `primaryTint` when filters are on. */
export function FilterPill({ count = 0, label, icon = 'list-filter', chevron = false, onClick, className }) {
  const active = count > 0;
  return (
    <button type="button" onClick={onClick} className={cx('bv', 'bv-pill', 'bv-pill-outlined', 'bv-filter', active && 'bv-filter-active', className)} aria-label={(label || 'Filters') + (active ? ', ' + count + ' on' : '')}>
      {icon ? <Icon name={icon} size={18} strokeWidth={2} /> : null}
      {label ? <span>{label}</span> : null}
      {active ? <span className="bv-count-badge">{count}</span> : null}
      {chevron ? <Icon name="chevron-down" size={16} strokeWidth={2} /> : null}
    </button>
  );
}

/** "↓↑ Score" text button in `primary`, with a search icon at the right edge of its row only when `onSearch` is given. */
export function SortToggle({ label = 'Score', onClick, onSearch, className }) {
  return (
    <div className={cx('bv', 'bv-sort', className)}>
      <button type="button" className="bv-sort-btn heading" onClick={onClick} aria-label={'Sort by ' + label}>
        <Icon name="arrow-up-down" size={16} strokeWidth={2.25} />
        <span>{label}</span>
      </button>
      {typeof onSearch === 'function' ? (
        <button type="button" className="bv-sort-search" onClick={onSearch} aria-label="Search this list">
          <Icon name="search" size={22} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

/** Loading placeholder in the shape of the final layout. No bare spinners outside buttons. */
export function Skeleton({ variant = 'text', width, height, lines = 1, className }) {
  if (variant === 'row') {
    return (
      <div className={cx('bv', 'bv-skel-row', className)} aria-busy="true" aria-label="Loading">
        <div className="bv-skel-lines">
          <span className="bv-skel" style={{ width: '58%', height: 20 }} />
          <span className="bv-skel" style={{ width: '34%', height: 14 }} />
          <span className="bv-skel" style={{ width: '46%', height: 14 }} />
          <span className="bv-skel" style={{ width: '28%', height: 14, marginTop: 18 }} />
        </div>
        <span className="bv-skel bv-skel-circle" style={{ width: 40, height: 40 }} />
      </div>
    );
  }
  if (variant === 'post') {
    return (
      <div className={cx('bv', 'bv-skel-post', className)} aria-busy="true" aria-label="Loading">
        <div className="bv-skel-head">
          <span className="bv-skel bv-skel-circle" style={{ width: 60, height: 60 }} />
          <div className="bv-skel-lines">
            <span className="bv-skel" style={{ width: '80%', height: 20 }} />
            <span className="bv-skel" style={{ width: '50%', height: 14 }} />
          </div>
        </div>
        <span className="bv-skel" style={{ width: 155, height: 155, borderRadius: 14 }} />
        <span className="bv-skel" style={{ width: '90%', height: 14 }} />
      </div>
    );
  }
  if (variant === 'circle') return <span className={cx('bv', 'bv-skel', 'bv-skel-circle', className)} style={{ width: width || 40, height: height || width || 40 }} aria-hidden="true" />;
  if (variant === 'block') return <span className={cx('bv', 'bv-skel', className)} style={{ width: width || '100%', height: height || 120, borderRadius: 14 }} aria-hidden="true" />;
  return (
    <div className={cx('bv', 'bv-skel-lines', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => <span key={i} className="bv-skel" style={{ width: i === lines - 1 && lines > 1 ? '60%' : width || '100%', height: height || 14 }} />)}
    </div>
  );
}
