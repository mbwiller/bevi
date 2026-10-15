import React from 'react';
import { cx, Icon, BUCKETS } from './core.jsx';
import { Avatar, BevImage, Pill } from './primitives.jsx';

/**
 * Underline tabs. `underline-text`: 20pt text tabs that scroll, 3pt underline in `text`.
 * `underline-icon`: equal-width icon + 17pt label tabs, underline in `text` or `primary`.
 */
export function SegmentedTabs({ tabs = [], value, onChange, variant = 'underline-text', accent = 'text', className }) {
  const [cur, setCur] = React.useState(value ?? (tabs[0] && tabs[0].id));
  const active = value ?? cur;
  const listRef = React.useRef(null);
  const [bar, setBar] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
    if (el) setBar({ left: el.offsetLeft + (variant === 'underline-text' ? 0 : 0), width: el.offsetWidth });
  }, [active, variant, tabs.length]);
  const pick = (id) => { setCur(id); onChange && onChange(id); };
  return (
    <div className={cx('bv', 'bv-tabs', 'bv-tabs-' + variant, 'bv-tabs-accent-' + accent, className)}>
      <div className="bv-tabs-list" role="tablist" ref={listRef}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={cx('bv-tab', variant === 'underline-text' ? 'tabLabel' : 'heading', t.id === active && 'bv-tab-active')}
            onClick={() => pick(t.id)}
          >
            {t.icon ? <Icon name={t.icon} size={20} strokeWidth={1.75} /> : null}
            <span>{t.label}</span>
            {t.chevron ? <Icon name="chevron-down" size={16} strokeWidth={2} /> : null}
          </button>
        ))}
        {bar ? <span className="bv-tabs-bar" style={{ transform: 'translateX(' + bar.left + 'px)', width: bar.width }} aria-hidden="true" /> : null}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'feed', label: 'Feed', icon: 'newspaper' },
  { id: 'lists', label: 'Your Lists', icon: 'list' },
  { id: 'add', label: 'Add Bev' },
  { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy' },
  { id: 'profile', label: 'Profile' },
];

/** The five-tab bar. Centre tab: a 32pt `primary` circle with a white plus, inline with the others. */
export function TabBar({ active = 'feed', user = {}, onChange, safeArea = true, className }) {
  return (
    <nav className={cx('bv', 'bv-tabbar', safeArea && 'bv-tabbar-safe', className)} aria-label="Main">
      {TABS.map((t) => (
        <button key={t.id} type="button" className={cx('bv-tabbar-item', t.id === active && 'bv-tabbar-active')} aria-current={t.id === active ? 'page' : undefined} onClick={() => onChange && onChange(t.id)}>
          <span className="bv-tabbar-icon">
            {t.id === 'add' ? (
              <span className="bv-tabbar-add"><Icon name="plus" size={22} strokeWidth={2.25} /></span>
            ) : t.id === 'profile' ? (
              <Avatar name={user.name} src={user.src} size={32} ring={t.id === active} />
            ) : (
              <Icon name={t.icon} size={28} strokeWidth={1.5} />
            )}
          </span>
          <span className="tabBar bv-tabbar-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Search input. `filled`: grey 36pt bar (Feed). `outlined`: 48pt field (Add Bev). */
export function SearchBar({ placeholder = 'Search a Bev or a person', value, onChange, variant = 'filled', autoFocus, onClear, className, id }) {
  const [v, setV] = React.useState(value ?? '');
  const val = value ?? v;
  return (
    <label className={cx('bv', 'bv-search', 'bv-search-' + variant, className)}>
      <Icon name="search" size={variant === 'outlined' ? 22 : 20} strokeWidth={2} />
      <input
        id={id}
        className="bodyLarge"
        type="search"
        placeholder={placeholder}
        value={val}
        autoFocus={autoFocus}
        onChange={(e) => { setV(e.target.value); onChange && onChange(e.target.value); }}
        aria-label={placeholder}
      />
      {val ? (
        <button type="button" className="bv-search-clear" aria-label="Clear search" onClick={() => { setV(''); onChange && onChange(''); onClear && onClear(); }}>
          <Icon name="x" size={18} strokeWidth={2} />
        </button>
      ) : null}
    </label>
  );
}

/** Labelled 48pt text field for onboarding and the create wizard. */
export function TextField({ label, value, defaultValue, placeholder, prefix, hint, error, onChange, id, type = 'text', className }) {
  const fid = id || 'bv-field-' + (label || placeholder || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className={cx('bv', 'bv-field', error && 'bv-field-error', className)}>
      {label ? <label className="caption bv-field-label" htmlFor={fid}>{label}</label> : null}
      <div className="bv-field-box">
        {prefix ? <span className="bodyLarge bv-field-prefix">{prefix}</span> : null}
        <input id={fid} className="bodyLarge" type={type} value={value} defaultValue={defaultValue} placeholder={placeholder} onChange={onChange} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? fid + '-msg' : undefined} />
      </div>
      {error || hint ? <p id={fid + '-msg'} className={cx('caption', error ? 'bv-field-errmsg' : 'bv-meta')}>{error || hint}</p> : null}
    </div>
  );
}

/** Four tappable $ cells plus "Not sure, estimate it". */
export function PriceTierPicker({ value, estimated = false, onChange, className }) {
  const [state, setState] = React.useState({ tier: value ?? null, est: estimated });
  const cur = value !== undefined ? { tier: value, est: estimated } : state;
  const set = (next) => { setState(next); onChange && onChange(next.tier, next.est); };
  return (
    <div className={cx('bv', 'bv-tierpick', className)}>
      <div className="bv-tierpick-row" role="radiogroup" aria-label="Price tier">
        {[1, 2, 3, 4].map((t) => (
          <button key={t} type="button" role="radio" aria-checked={cur.tier === t && !cur.est} aria-label={'$'.repeat(t)} className={cx('bv-tierpick-cell', 'heading', cur.tier === t && !cur.est && 'bv-tierpick-on')} onClick={() => set({ tier: t, est: false })}>
            {'$'.repeat(t)}
          </button>
        ))}
      </div>
      <Pill variant="outlined" active={cur.est} icon={cur.est ? 'check' : undefined} onClick={() => set({ tier: null, est: !cur.est })}>Not sure, estimate it</Pill>
    </div>
  );
}

const BUCKET_ICON = { loved: 'laugh', fine: 'meh', disliked: 'frown' };
const WAVE = 'M0 8 Q30 1 60 8 T120 8 T180 8 T240 8 V16 H0 Z';
/**
 * Gut-check choice: a capsule with a glossy orb in its bucket colour. Choosing it pours that colour in
 * (two-thirds full, a moving surface, a few rising bubbles). Sit it on a BevGlow.
 * `material="tint"` (default, and always on the web app): 12% bucket tint and a bucket bar.
 * `material="glass"`: liquid glass, only with the native GlassView on iOS 26+; never imitated with a blur.
 */
export function BucketButton({ bucket = 'loved', selected = false, material = 'tint', onClick, className }) {
  const b = BUCKETS[bucket];
  return (
    <button type="button" className={cx('bv', 'bv-bucket', 'bv-band-' + b.band, material === 'tint' && 'bv-bucket-tint', selected && 'bv-bucket-on', className)} onClick={onClick} aria-pressed={selected}>
      <span className="bv-bucket-liquid" aria-hidden="true">
        <svg className="bv-bucket-wave bv-bucket-wave-back" viewBox="0 0 240 16" preserveAspectRatio="none"><path d={WAVE} /></svg>
        <svg className="bv-bucket-wave" viewBox="0 0 240 16" preserveAspectRatio="none"><path d={WAVE} /></svg>
        <i className="bv-bucket-fizz" /><i className="bv-bucket-fizz" /><i className="bv-bucket-fizz" />
      </span>
      <span className="bv-bucket-orb"><Icon name={BUCKET_ICON[bucket]} size={22} strokeWidth={2.25} /></span>
      <span className="heading bv-bucket-label">{b.label}</span>
      <span className="bv-bucket-check">{selected ? <Icon name="check" size={16} strokeWidth={3} /> : null}</span>
    </button>
  );
}

/** Soft colour field behind glass: the Bev's own colour with `primary` and `fizz`, blurred. Wraps the gut check. */
export function BevGlow({ color, children, className, style }) {
  return (
    <div className={cx('bv', 'bv-glow', className)} style={Object.assign({}, style, color ? { '--glow': color } : null)}>
      <span className="bv-glow-blob bv-glow-a" aria-hidden="true" />
      <span className="bv-glow-blob bv-glow-b" aria-hidden="true" />
      <span className="bv-glow-blob bv-glow-c" aria-hidden="true" />
      <div className="bv-glow-content">{children}</div>
    </div>
  );
}

/** One side of "Which was better?": BevImage 96, name, brand, and where the incumbent sits now. */
export function CompareCard({ bev, rankLabel, isNew = false, selected = false, onClick, className }) {
  return (
    <button type="button" className={cx('bv', 'bv-compare', selected && 'bv-compare-on', className)} onClick={onClick} aria-pressed={selected} aria-label={bev.name + (isNew ? ', candidate' : rankLabel ? ', currently ' + rankLabel : '')}>
      <BevImage size={96} src={bev.src} art={bev.art} alt={bev.name} />
      <span className="bv-compare-text">
        {isNew ? <span className="caption bv-compare-tag">New</span> : rankLabel ? <span className="caption bv-meta">{rankLabel}</span> : null}
        <span className="screenTitle">{bev.name}</span>
        <span className="body bv-meta">{bev.brand}</span>
      </span>
      {selected ? <span className="bv-compare-check"><Icon name="check" size={18} strokeWidth={3} /></span> : null}
    </button>
  );
}

/** Comparison progress: one dot per possible comparison (`maxComparisons(n)`). */
export function ProgressDots({ total = 5, current = 0, className }) {
  return (
    <div className={cx('bv', 'bv-dots', className)} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current} aria-label={'Comparison ' + Math.min(current + 1, total) + ' of up to ' + total}>
      {Array.from({ length: total }).map((_, i) => <span key={i} className={cx('bv-dot', i < current && 'bv-dot-done', i === current && 'bv-dot-now')} />)}
    </div>
  );
}

/** Centred message for an empty list, with one action. */
export function EmptyState({ icon = 'cup-soda', title, body, action, onAction, className }) {
  return (
    <div className={cx('bv', 'bv-empty', className)}>
      <span className="bv-empty-icon"><Icon name={icon} size={28} strokeWidth={1.75} /></span>
      <p className="heading bv-empty-title">{title}</p>
      {body ? <p className="body bv-meta bv-empty-body">{body}</p> : null}
      {action ? <Pill variant="filled" onClick={onAction}>{action}</Pill> : null}
    </div>
  );
}

/** Failure message from `BeviApi` errors with a Retry. */
export function ErrorState({ title = "Couldn't load this", message = 'Check your connection and try again.', onRetry, icon = 'triangle-alert', className }) {
  return (
    <div className={cx('bv', 'bv-empty', 'bv-error', className)} role="alert">
      <span className="bv-empty-icon"><Icon name={icon} size={28} strokeWidth={1.75} /></span>
      <p className="heading bv-empty-title">{title}</p>
      <p className="body bv-meta bv-empty-body">{message}</p>
      <Pill variant="outlined" icon="refresh-cw" onClick={onRetry}>Retry</Pill>
    </div>
  );
}

/** Comments longer than this are refused (the contract's `comments.add` limit). */
export const COMMENT_MAX = 280;

/**
 * The post's comments in a 90% Sheet: oldest at the top and newest just above the composer, like a chat.
 * Each comment: Avatar 32, bold handle, the text, a relative time; your own add a Delete. The composer
 * ("Add a comment…" and a `primary` Post) stays pinned to the bottom.
 */
export function CommentsSheet({ open = true, comments = [], me, onClose, onPost, onDelete, error, className }) {
  const [draft, setDraft] = React.useState('');
  const body = draft.trim();
  const left = COMMENT_MAX - draft.length;
  const post = () => { if (!body || left < 0) return; if (onPost) onPost(body); setDraft(''); };
  return (
    <Sheet open={open} title="Comments" snap={90} onClose={onClose} className={cx('bv-comments', className)}>
      {comments.length ? (
        <ul className="bv-comment-list">
          {comments.map((c, i) => (
            <li key={c.id || i} className="bv-comment-row">
              <Avatar name={c.author && c.author.name} src={c.author && c.author.src} size={32} />
              <div className="bv-comment-text">
                <p className="body"><b>{c.author && c.author.handle}</b> <span className="bv-meta">{c.time}</span></p>
                <p className="body bv-comment-body">{c.body}</p>
              </div>
              {c.mine ? <button type="button" className="body bv-comment-delete" onClick={() => onDelete && onDelete(c.id)} aria-label={'Delete your comment: ' + c.body}>Delete</button> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="message-circle" title="No comments yet" body="Start the conversation." />
      )}
      <form className="bv-composer" onSubmit={(e) => { e.preventDefault(); post(); }}>
        {me ? <Avatar name={me.name} src={me.src} size={32} /> : null}
        <input className="bodyLarge bv-composer-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment…" aria-label="Add a comment" />
        {left <= 20 ? <span className={cx('caption', left < 0 ? 'bv-field-errmsg' : 'bv-meta')} aria-live="polite">{left}</span> : null}
        <button type="submit" className="body bv-composer-post" disabled={!body || left < 0}>Post</button>
      </form>
      {error ? <p className="caption bv-field-errmsg bv-composer-error" role="alert">{error}</p> : null}
    </Sheet>
  );
}

/** Bottom sheet with a handle; snaps to 40% or 90% of its container. Fills the nearest positioned ancestor. */
export function Sheet({ open = true, title, snap = 40, onClose, children, className }) {
  if (!open) return null;
  return (
    <div className={cx('bv', 'bv-sheet-wrap', className)}>
      <div className="bv-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="bv-sheet" role="dialog" aria-modal="true" aria-label={title} style={{ height: snap + '%' }}>
        <span className="bv-sheet-handle" aria-hidden="true" />
        {title ? <h2 className="heading bv-sheet-title">{title}</h2> : null}
        <div className="bv-sheet-body">{children}</div>
      </div>
    </div>
  );
}
