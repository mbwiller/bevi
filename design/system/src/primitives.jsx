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

/** Circle with initials on `avatarFill`, or a photo. Sizes 24 (inline comments), 32 (tab bar, comments sheet), 44, 60 (posts), 100 (profile). */
export function Avatar({ name = '', src, size = 44, className, ring = false }) {
  return (
    <span className={cx('bv', 'bv-avatar', 'bv-avatar-' + size, ring && 'bv-avatar-ring', className)} style={{ width: size, height: size }} role="img" aria-label={name}>
      {src ? <img src={src} alt="" /> : <span className="bv-avatar-initials">{initialsOf(name)}</span>}
    </span>
  );
}

/**
 * Your own photo where it can be changed (Edit profile, onboarding): Avatar 100 over "Add a photo" /
 * "Change photo" in `primary` and "Remove" in `textSecondary`. `busy` covers the circle with a spinner while
 * the picture uploads; the photo is saved as soon as it lands, with no Save step.
 */
export function AvatarPicker({ name = '', src, busy = false, error, onChange, onRemove, className }) {
  return (
    <div className={cx('bv', 'bv-avatarpicker', className)}>
      <span className="bv-avatarpicker-circle">
        <Avatar name={name} src={src} size={100} />
        {busy ? <span className="bv-avatarpicker-busy" role="status" aria-label="Uploading your photo"><span className="bv-spinner" aria-hidden="true" /></span> : null}
      </span>
      <span className="bv-avatarpicker-actions">
        <button type="button" className="body bv-avatarpicker-change" onClick={onChange} disabled={busy}>{src ? 'Change photo' : 'Add a photo'}</button>
        {src && onRemove ? <button type="button" className="body bv-avatarpicker-remove" onClick={onRemove} disabled={busy} aria-label="Remove photo">Remove</button> : null}
      </span>
      {error ? <p className="caption bv-field-errmsg bv-avatarpicker-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** How far past "just fills the circle" a photo can be zoomed. */
export const CROP_MAX_ZOOM = 4;

/**
 * The step between picking a profile photo and uploading it: the whole screen, "Move and scale" over
 * the photo with a circle cut out of a `photoScrim`, then "Use photo" and "Cancel". The photo always
 * fills the circle: drag to move it, pinch (here, the wheel) to zoom up to `CROP_MAX_ZOOM`, double-tap for 2 times and back.
 * `onDone` gets the framed square in the photo's own pixels.
 */
export function PhotoCropper({ src, width = 1, height = 1, onDone, onCancel, className }) {
  const stage = React.useRef(null);
  const grab = React.useRef(null);
  const [side, setSide] = React.useState(0);
  const [view, setView] = React.useState({ zoom: 1, x: 0, y: 0 });
  React.useLayoutEffect(() => {
    const measure = () => { if (stage.current) setSide(stage.current.getBoundingClientRect().width); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // The circle is inset from the stage by the gutter (16).
  const d = Math.max(0, side - 32);
  const base = d / Math.min(width, height);
  const clamp = (v) => {
    const zoom = Math.min(CROP_MAX_ZOOM, Math.max(1, v.zoom));
    const maxX = Math.max(0, (width * base * zoom - d) / 2);
    const maxY = Math.max(0, (height * base * zoom - d) / 2);
    return { zoom, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  };
  const down = (e) => { grab.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { const g = grab.current; if (g) setView((v) => clamp({ zoom: v.zoom, x: g.x + e.clientX - g.px, y: g.y + e.clientY - g.py })); };
  const up = () => { grab.current = null; };
  const wheel = (e) => {
    const closer = e.deltaY < 0;
    setView((v) => {
      const zoom = Math.min(CROP_MAX_ZOOM, Math.max(1, v.zoom * (closer ? 1.1 : 1 / 1.1)));
      // The point under the circle's centre stays put.
      return clamp({ zoom, x: (v.x * zoom) / v.zoom, y: (v.y * zoom) / v.zoom });
    });
  };
  // A double tap: in to 2 times, or back to the start.
  const twice = () => setView((v) => (v.zoom > 1 ? { zoom: 1, x: 0, y: 0 } : clamp({ zoom: 2, x: v.x * 2, y: v.y * 2 })));
  const done = () => {
    if (!onDone || !d) return;
    const size = Math.min(width, height) / view.zoom;
    const x = width / 2 - view.x / (base * view.zoom) - size / 2;
    const y = height / 2 - view.y / (base * view.zoom) - size / 2;
    const whole = Math.max(1, Math.min(Math.round(size), width, height));
    onDone({ x: Math.min(width - whole, Math.max(0, Math.round(x))), y: Math.min(height - whole, Math.max(0, Math.round(y))), size: whole });
  };
  return (
    <div className={cx('bv', 'bv-cropper', className)} role="dialog" aria-modal="true" aria-label="Move and scale">
      <p className="heading bv-cropper-title">Move and scale</p>
      <div ref={stage} className="bv-cropper-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onDoubleClick={twice}>
        {d ? (
          <img
            src={src}
            alt=""
            draggable={false}
            className="bv-cropper-photo"
            style={{ width: width * base, height: height * base, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          />
        ) : null}
        <span className="bv-cropper-mask" aria-hidden="true" />
      </div>
      <p className="caption bv-meta bv-cropper-hint">Drag to move. Pinch to zoom.</p>
      <div className="bv-cropper-actions">
        <Button variant="primary" block onClick={done}>Use photo</Button>
        <Button variant="ghost" block onClick={onCancel}>Cancel</Button>
      </div>
    </div>
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

/**
 * The Want to Try bookmark with its 44pt target: outline until saved, then filled `primary`.
 * A press pops it like the heart (transform only). Shared by BevRow and FeedPost.
 */
export function SaveButton({ saved = false, onClick, className }) {
  const [pop, setPop] = React.useState(0);
  return (
    <button
      type="button"
      className={cx('bv-iconbtn', 'bv-iconbtn-plain', saved && 'bv-saved', className)}
      aria-pressed={saved}
      aria-label={saved ? 'Saved to Want to Try' : 'Save to Want to Try'}
      onClick={() => { setPop((n) => n + 1); if (onClick) onClick(); }}
    >
      <span key={pop} className={cx('bv-pop-box', pop > 0 && 'bv-pop')}><Icon name="bookmark" size={28} strokeWidth={1.6} filled={saved} /></span>
    </button>
  );
}

/**
 * The Follow / Following pill of a person row and an Explore post: filled `primary` "Follow", outlined
 * "Following". A press pops it like the heart (transform only).
 */
export function FollowPill({ following = false, onClick, label }) {
  const [pop, setPop] = React.useState(0);
  return (
    <span key={pop} className={cx('bv-pop-box', pop > 0 && 'bv-pop')}>
      <Pill variant={following ? 'outlined' : 'filled'} aria-pressed={following} aria-label={label} onClick={() => { setPop((n) => n + 1); if (onClick) onClick(); }}>
        {following ? 'Following' : 'Follow'}
      </Pill>
    </span>
  );
}

/** A 4pt track in `input` with a `primary` fill: a share you've earned (ProgressStrip, CollectionSheet). `tone` recolours the fill with a score band (TasteBar). Decorative; its parent says the number. */
export function ProgressBar({ value = 0, tone = 'primary', className }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className={cx('bv-progress-track', className)} aria-hidden="true">
      <span className={cx('bv-progress-fill', tone !== 'primary' && 'bv-progress-fill-' + tone)} style={{ width: pct + '%' }} />
    </span>
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
          <span className="bv-skel" style={{ width: '28%', height: 14, marginTop: 8 }} />
        </div>
        <span className="bv-skel bv-skel-circle" style={{ width: 40, height: 40 }} />
      </div>
    );
  }
  if (variant === 'post') {
    return (
      <div className={cx('bv', 'bv-skel-post', className)} aria-busy="true" aria-label="Loading">
        <div className="bv-skel-head">
          <span className="bv-skel bv-skel-circle" style={{ width: 44, height: 44 }} />
          <div className="bv-skel-lines">
            <span className="bv-skel" style={{ width: '80%', height: 18 }} />
            <span className="bv-skel" style={{ width: '50%', height: 14 }} />
          </div>
        </div>
        <div className="bv-skel-body">
          <span className="bv-skel" style={{ width: 112, height: 112, borderRadius: 14, flex: 'none' }} />
          <div className="bv-skel-lines">
            <span className="bv-skel" style={{ width: '92%', height: 14 }} />
            <span className="bv-skel" style={{ width: '70%', height: 14 }} />
          </div>
        </div>
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
