import React from 'react';
import { cx, Icon, BUCKETS, categoryById, formatTried, spokenTried } from './core.jsx';
import { Avatar, BevImage, Pill, ProgressBar } from './primitives.jsx';

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
  { id: 'lists', label: 'Lists', icon: 'list' },
  { id: 'add', label: 'Add Bev' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'profile', label: 'Profile' },
];

/**
 * The five-tab bar: Feed, Lists, Add Bev, Map, Profile. Add Bev is a 46pt `primary` circle with a plus that
 * rises 14pt above the other icons, ringed in `surface` where it crosses the bar's hairline. The current
 * tab's icon and label turn `primary`.
 */
export function TabBar({ active = 'feed', user = {}, onChange, safeArea = true, className }) {
  return (
    <nav className={cx('bv', 'bv-tabbar', safeArea && 'bv-tabbar-safe', className)} aria-label="Main">
      {TABS.map((t) => (
        <button key={t.id} type="button" className={cx('bv-tabbar-item', t.id === active && 'bv-tabbar-active')} aria-current={t.id === active ? 'page' : undefined} onClick={() => onChange && onChange(t.id)}>
          <span className={cx('bv-tabbar-icon', t.id === 'add' && 'bv-tabbar-icon-add')}>
            {t.id === 'add' ? (
              <span className="bv-tabbar-add"><Icon name="plus" size={26} strokeWidth={2.25} /></span>
            ) : t.id === 'profile' ? (
              <Avatar name={user.name} src={user.src} size={32} />
            ) : (
              <Icon name={t.icon} size={28} strokeWidth={t.id === active ? 2 : 1.5} />
            )}
          </span>
          <span className="tabBar bv-tabbar-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The Map tab's art: a round minimap, dark until walked, with a lit path from you to the nearest Bev.
 * One picture, not a live map: the ground is `tasteCard`, the streets and the lit path are `onDeep`,
 * the route and its destination are `primary`, and you are the `fizz` dot with a heading triangle.
 */
export function FindBevArt({ size = 224, title = 'A round minimap: your position, a lit path and a destination', className }) {
  const raw = React.useId ? React.useId() : 'a';
  const clip = 'bv-findart-' + String(raw).replace(/[^a-zA-Z0-9]/g, '');
  const path = 'M74 176 L92 96 L150 108 L164 52';
  return (
    <svg className={cx('bv-findart', className)} width={size} height={size} viewBox="0 0 224 224" role="img" aria-label={title}>
      <defs><clipPath id={clip}><circle cx="112" cy="112" r="111" /></clipPath></defs>
      <g clipPath={'url(#' + clip + ')'}>
        <rect className="bv-findart-ground" x="0" y="0" width="224" height="224" />
        {[34, 78, 122, 166, 210].map((v) => <path key={'v' + v} className="bv-findart-street" d={'M' + v + ' -10 L' + (v - 46) + ' 240'} />)}
        {[20, 66, 112, 158, 204].map((v) => <path key={'h' + v} className="bv-findart-street" d={'M-10 ' + v + ' L240 ' + (v + 44)} />)}
        <path className="bv-findart-lit" d={path} />
        <path className="bv-findart-route" d={path} />
        <circle className="bv-findart-dest" cx="164" cy="52" r="11" />
        <path className="bv-findart-heading" d="M74 150 L84 168 L64 168 Z" />
        <circle className="bv-findart-you" cx="74" cy="176" r="10" />
      </g>
      <circle className="bv-findart-rim" cx="112" cy="112" r="111" />
    </svg>
  );
}

/** Search input. `filled`: grey 36pt bar (Feed, People). `outlined`: 48pt field (Add Bev). */
export function SearchBar({ placeholder = 'Search a Bev or a person', value, onChange, variant = 'filled', autoFocus, onClear, onFocus, className, id }) {
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
        onFocus={onFocus}
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

/**
 * Gut-check choice: a `primary` ring filled to a level (loved full, fine half, disliked empty) over its label.
 * The level carries the order, so it never leans on colour. The chosen one gets a check badge; pass `dimmed`
 * to the other two once one is chosen.
 */
export function BucketButton({ bucket = 'loved', selected = false, dimmed = false, onClick, className }) {
  const b = BUCKETS[bucket];
  return (
    <button type="button" className={cx('bv', 'bv-bucket', 'bv-bucket-' + bucket, selected && 'bv-bucket-on', dimmed && 'bv-bucket-dim', className)} onClick={onClick} aria-pressed={selected}>
      <span className="bv-bucket-disc" aria-hidden="true">
        <span className="bv-bucket-well"><span className="bv-bucket-fill" /></span>
        <span className="bv-bucket-badge"><Icon name="check" size={16} strokeWidth={3} /></span>
      </span>
      <span className="body bv-bucket-label">{b.label}</span>
    </button>
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

/**
 * "Your collection": every category you can see, in catalog order, with "9 of 40" and a 4pt bar.
 * Empty categories are left out. A row is a button: it scopes Bev'd to that category and closes.
 */
export function CollectionSheet({ open = true, rows = [], onClose, onSelect, className }) {
  const shown = rows.filter((r) => r.total > 0 && categoryById(r.categoryId));
  const ranked = shown.reduce((n, r) => n + r.ranked, 0);
  const total = shown.reduce((n, r) => n + r.total, 0);
  return (
    <Sheet open={open} title="Your collection" snap={90} onClose={onClose} className={cx('bv-collection', className)}>
      <p className="body bv-meta bv-collection-sum">
        <span aria-hidden="true">{formatTried(ranked, total)}</span>
        <span className="bv-sr-only">{spokenTried(ranked, total)}</span>
      </p>
      <ul className="bv-collection-list">
        {shown.map((r) => {
          const cat = categoryById(r.categoryId);
          return (
            <li key={r.categoryId}>
              <button type="button" className="bv-collection-row" onClick={() => onSelect && onSelect(r.categoryId)}
                aria-label={cat.label + ', ' + spokenTried(r.ranked, r.total) + '. Show only ' + cat.label}>
                <Icon name={cat.icon} size={24} strokeWidth={1.75} />
                <span className="bv-collection-text">
                  <span className="bv-collection-top">
                    <span className="heading bv-collection-label">{cat.label}</span>
                    <span className="body bv-meta bv-collection-count">{r.ranked} of {r.total}</span>
                  </span>
                  <ProgressBar value={r.ranked / r.total} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
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
