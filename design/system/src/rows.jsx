import React from 'react';
import { cx, Icon, Wordmark, BevArt, categoryById, formatRatings } from './core.jsx';
import { ScoreBubble, PriceTier, Avatar, BevImage, Pill, IconButton, LikeButton, CommentButton } from './primitives.jsx';

/** Comments shown on the post itself; above this many, the post collapses to "View all N comments". */
export const INLINE_COMMENTS = 7;

function CategoryMark({ category }) {
  const cat = categoryById(category);
  return cat ? <Icon name={cat.icon} size={16} strokeWidth={2} className="bv-catmark" title={cat.label} /> : null;
}
const brandLine = (bev) => [bev.brand, bev.flavor && bev.flavor !== 'Original' ? bev.flavor : null].filter(Boolean).join(' · ');

/** Screen header: 44pt row, title (20pt bold) or the wordmark on the left, 28pt icons on the right; or a centred caps title. */
export function Header({ title, wordmark = false, centered = false, actions = [], onBack, className }) {
  return (
    <header className={cx('bv', 'bv-header', centered && 'bv-header-centered', className)}>
      <div className="bv-header-lead">
        {onBack ? <IconButton icon="chevron-left" label="Back" onClick={onBack} /> : null}
        {wordmark ? <Wordmark height={28} /> : !centered && title ? <h1 className="screenTitle bv-header-title">{title}</h1> : null}
      </div>
      {centered && title ? <h1 className="sectionCaps bv-header-caps">{title}</h1> : null}
      <div className="bv-header-actions">
        {actions.map((a, i) => <IconButton key={i} {...a} />)}
      </div>
    </header>
  );
}

/** "FEATURED BEVS" caps label with an optional "See all" link in `primary`. */
export function SectionHeader({ title, action, onAction, className }) {
  return (
    <div className={cx('bv', 'bv-section', className)}>
      <h2 className="sectionCaps bv-section-title">{title}</h2>
      {action ? <button type="button" className="bv-link sectionCaps" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

/** Beli's "All ⌄": a 28pt bold label that opens a sheet to scope the list to one category. */
export function ListScopeDropdown({ label = 'All', onClick, className }) {
  return (
    <button type="button" className={cx('bv', 'bv-scope', 'displayDrop', className)} onClick={onClick} aria-haspopup="dialog">
      <span>{label}</span>
      <Icon name="chevron-down" size={22} strokeWidth={2.25} />
    </button>
  );
}

/**
 * The list row (~126pt): name, `$$ • Category`, category icon • brand, a meta line, actions, and a ScoreBubble 40.
 * The meta line is `meta` when given; otherwise the rating count ("362 ratings") when `count` > 0.
 * No image by default, as in the reference; pass `showImage` for search results.
 */
export function BevRow({ bev, number, score, scoreVariant, count, meta, saved = false, onRank, onSave, actions = true, showImage = false, divider = true, onClick, className }) {
  const cat = categoryById(bev.category);
  return (
    <div className={cx('bv', 'bv-bevrow', divider && 'bv-divider', className)}>
      <button type="button" className="bv-bevrow-main" onClick={onClick} aria-label={(number ? number + '. ' : '') + bev.name}>
        {showImage ? <BevImage size={56} src={bev.src} art={bev.art} alt={bev.name} status={bev.photoStatus} /> : null}
        <span className="bv-bevrow-text">
          <span className="screenTitle bv-bevrow-name">{number != null ? number + '. ' : ''}{bev.name}</span>
          <span className="body bv-bevrow-line"><PriceTier tier={bev.priceTier} estimated={bev.priceEstimated} /> • {cat ? cat.label : ''}</span>
          <span className="body bv-bevrow-line"><CategoryMark category={bev.category} /> • {brandLine(bev)}</span>
        </span>
      </button>
      <span className="bv-bevrow-score">
        {score !== undefined || scoreVariant ? <ScoreBubble score={score} variant={scoreVariant} /> : null}
      </span>
      <div className="bv-bevrow-foot">
        <span className="body bv-meta">{meta != null && meta !== '' ? meta : count > 0 ? formatRatings(count) : null}</span>
        {actions ? (
          <span className="bv-actions">
            <IconButton icon="circle-plus" label={'Rank ' + bev.name} onClick={onRank} />
            <button type="button" className={cx('bv-iconbtn', 'bv-iconbtn-plain', saved && 'bv-saved')} onClick={onSave} aria-pressed={saved} aria-label={saved ? 'Saved to Want to Try' : 'Save to Want to Try'}>
              <Icon name="bookmark" size={28} strokeWidth={1.6} filled={saved} />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The big heart that bursts over a post's photo strip (or its centre) when a double-tap likes it. Transform and opacity only. */
function LikeBurst() {
  return (
    <span className="bv-like-burst" aria-hidden="true">
      <Icon name="heart" size={88} strokeWidth={1.6} filled />
    </span>
  );
}

/**
 * A ranking in the Feed and on Profile › Activity. Names bold, verb regular.
 * Double-tap anywhere outside the photo strip likes it (never unlikes); the heart in the action row is the way to unlike.
 */
export function FeedPost({ actor = {}, you = false, bev, score, scoreVariant, note, time, saved = false, liked = false, likeCount = 0, comments = [], commentCount = 0, photos, onRank, onSave, onLike, onComment, onOpen, divider = true, className }) {
  const [open, setOpen] = React.useState(false);
  const [burst, setBurst] = React.useState(0);
  const cat = categoryById(bev.category);
  const tiles = photos || [{ src: bev.src, art: bev.art }];
  const onDoubleClick = (e) => {
    // The photo strip keeps single tap = open the Bev; buttons keep their own action.
    if (e.target.closest && e.target.closest('.bv-post-strip, button')) return;
    setBurst((n) => n + 1);
    if (!liked && onLike) onLike();
  };
  return (
    <article className={cx('bv', 'bv-post', divider && 'bv-divider', className)} onDoubleClick={onDoubleClick}>
      <div className="bv-post-head">
        <Avatar name={actor.name} src={actor.src} size={60} />
        <div className="bv-post-head-text">
          <p className="screenTitle bv-post-line">
            <b>{you ? 'You' : (actor.name || '').split(' ')[0]}</b>
            <span className="bv-post-verb">{" Bev'd "}</span>
            <b>{bev.name}</b>
          </p>
          <p className="body bv-meta bv-post-meta">
            {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} /> : null}
            <span>{[' ', bev.brand].join('')}</span>
            <span> • </span>
            <PriceTier tier={bev.priceTier} estimated={bev.priceEstimated} />
          </p>
        </div>
        {score != null || scoreVariant ? <ScoreBubble score={score} variant={scoreVariant} className="bv-post-score" /> : null}
      </div>
      {tiles.length ? (
        <div className="bv-post-media">
          <div className="bv-post-strip" role="list">
            {tiles.map((t, i) => (
              <button type="button" role="listitem" key={i} className="bv-post-tile" onClick={onOpen} aria-label={'Open ' + bev.name}>
                <BevImage size={155} src={t.src} art={t.art} alt={bev.name} />
              </button>
            ))}
          </div>
          {burst ? <LikeBurst key={burst} /> : null}
        </div>
      ) : burst ? <LikeBurst key={burst} /> : null}
      {note ? (
        <p className="bodyLarge bv-post-note">
          <b>Notes:</b> {open || note.length <= 160 ? note : note.slice(0, 150).replace(/\s+\S*$/, '') + ' …'}
          {!open && note.length > 160 ? <button type="button" className="bv-seemore" onClick={() => setOpen(true)}>See more</button> : null}
        </p>
      ) : null}
      <div className="bv-post-foot">
        <span className="body bv-meta">{time}</span>
        <span className="bv-actions">
          <LikeButton liked={liked} count={likeCount} onClick={onLike} />
          <CommentButton count={commentCount} onClick={onComment} />
          <IconButton icon="circle-plus" label={'Rank ' + bev.name} onClick={onRank} />
          <button type="button" className={cx('bv-iconbtn', 'bv-iconbtn-plain', saved && 'bv-saved')} onClick={onSave} aria-pressed={saved} aria-label={saved ? 'Saved to Want to Try' : 'Save to Want to Try'}>
            <Icon name="bookmark" size={28} strokeWidth={1.6} filled={saved} />
          </button>
        </span>
      </div>
      {commentCount > INLINE_COMMENTS ? (
        <button type="button" className="body bv-post-allcomments" onClick={onComment}>{'View all ' + commentCount + ' comments'}</button>
      ) : comments.length ? (
        <ul className="bv-post-comments" aria-label="Comments">
          {comments.slice(0, INLINE_COMMENTS).map((c, i) => (
            <li key={c.id || i} className="body bv-post-comment"><b>{(c.author && c.author.handle) || ''}</b> {c.body}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** Profile link row (44pt): icon, 20pt label, count, chevron. */
export function ProfileListRow({ icon, iconFilled = false, label, count, onClick, divider = true, className }) {
  return (
    <button type="button" className={cx('bv', 'bv-plrow', divider && 'bv-divider', className)} onClick={onClick}>
      <Icon name={icon} size={24} strokeWidth={1.75} filled={iconFilled} className="bv-plrow-icon" />
      <span className="tabLabel bv-plrow-label">{label}</span>
      {count != null ? <span className="tabLabel bv-plrow-count">{count}</span> : null}
      <Icon name="chevron-right" size={20} strokeWidth={2} className="bv-plrow-chev" />
    </button>
  );
}

/** Profile stat card: `primary` icon, label over value. Two per row. */
export function StatCard({ icon, label, value, onClick, className }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={cx('bv', 'bv-statcard', className)} onClick={onClick}>
      <Icon name={icon} size={24} strokeWidth={1.75} className="bv-statcard-icon" />
      <span className="bv-statcard-text">
        <span className="bodyLarge bv-statcard-label">{label}</span>
        <span className="screenTitle bv-statcard-value">{value}</span>
      </span>
    </Tag>
  );
}

/** 164pt square photo card for the Featured carousel: image, bottom scrim, white title and subtitle. */
export function FeaturedCard({ title, subtitle, src, art, tint, onClick, className }) {
  return (
    <button type="button" className={cx('bv', 'bv-featured', className)} onClick={onClick} style={tint ? { background: tint } : undefined}>
      {src ? <img src={src} alt="" className="bv-featured-img" /> : art ? <span className="bv-featured-art"><BevArt {...art} /></span> : null}
      <span className="bv-featured-scrim" />
      <span className="bv-featured-text">
        <span className="screenTitle bv-featured-title">{title}</span>
        {subtitle ? <span className="body bv-featured-sub">{subtitle}</span> : null}
      </span>
    </button>
  );
}

/** Person row for People search, followers and the user leaderboard. */
export function UserRow({ user = {}, rank, meta, streak, following, self = false, onFollow, onClick, divider = true, className }) {
  return (
    <div className={cx('bv', 'bv-userrow', divider && 'bv-divider', self && 'bv-userrow-self', className)}>
      {rank != null ? <span className="heading bv-userrow-rank">{rank}</span> : null}
      <button type="button" className="bv-userrow-main" onClick={onClick}>
        <Avatar name={user.name} src={user.src} size={44} />
        <span className="bv-userrow-text">
          <span className="heading bv-userrow-name">{user.name}{self ? ' (you)' : ''}</span>
          <span className="body bv-meta">
            @{user.handle}
            {meta ? ' · ' + meta : ''}
            {streak ? <><span> · </span><Icon name="flame" size={14} strokeWidth={2.25} className="bv-flame" /> {streak}</> : null}
          </span>
        </span>
      </button>
      {following != null && !self ? (
        <Pill variant={following ? 'outlined' : 'filled'} onClick={onFollow} aria-pressed={following}>{following ? 'Following' : 'Follow'}</Pill>
      ) : null}
    </div>
  );
}
