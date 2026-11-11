import React from 'react';
import { cx, Icon, Wordmark, BevArt, categoryById, formatRatings, formatTried, spokenTried, formatScore, scoreBand } from './core.jsx';
import { ScoreBubble, Avatar, AvatarStack, BevImage, IconButton, LikeButton, CommentButton, SaveButton, FollowPill, ProgressBar } from './primitives.jsx';

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

/**
 * "FEATURED BEVS" caps label with an optional "See all" link in `primary`.
 * `actionLabel` replaces the link's spoken name when the action and the title don't read well together.
 */
export function SectionHeader({ title, action, actionLabel, onAction, className }) {
  return (
    <div className={cx('bv', 'bv-section', className)}>
      <h2 className="sectionCaps bv-section-title">{title}</h2>
      {action ? <button type="button" className="bv-link sectionCaps" onClick={onAction} aria-label={actionLabel ?? `${action} ${title.toLowerCase()}`}>{action}</button> : null}
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
 * The list row, about 94pt: an optional 56pt image, then the name and one line of category icon, category
 * and brand, with a ScoreBubble 40 at the right. The foot (the meta line on the left, the actions on the
 * right) sits directly under the category line and runs from the text column's left edge to the row's
 * right edge, so with no image it spans the row. No price on a row (D-06).
 * The meta line is `meta` when given; otherwise the rating count ("362 ratings") when `count` > 0.
 * No image by default, as in the reference; pass `showImage` for search results and the Top list.
 */
export function BevRow({ bev, number, score, scoreVariant, count, meta, saved = false, onRank, onSave, actions = true, showImage = false, divider = true, onClick, className }) {
  const cat = categoryById(bev.category);
  return (
    <div className={cx('bv', 'bv-bevrow', divider && 'bv-divider', className)}>
      {showImage ? (
        // The picture opens the Bev too; the name button is the one a screen reader and the Tab key meet.
        <button type="button" className="bv-bevrow-img" onClick={onClick} tabIndex={-1} aria-hidden="true">
          <BevImage size={56} src={bev.src} art={bev.art} alt={bev.name} status={bev.photoStatus} />
        </button>
      ) : null}
      <div className="bv-bevrow-body">
        <div className="bv-bevrow-top">
          <button type="button" className="bv-bevrow-main" onClick={onClick} aria-label={(number ? number + '. ' : '') + bev.name}>
            <span className="bv-bevrow-text">
              <span className="screenTitle bv-bevrow-name">{number != null ? number + '. ' : ''}{bev.name}</span>
              <span className="body bv-bevrow-line">
                <CategoryMark category={bev.category} />
                <span className="bv-bevrow-line-text">{[cat ? cat.label : null, brandLine(bev) || null].filter(Boolean).join(' · ')}</span>
              </span>
            </span>
          </button>
          <span className="bv-bevrow-score">
            {score !== undefined || scoreVariant ? <ScoreBubble score={score} variant={scoreVariant} /> : null}
          </span>
        </div>
        <div className="bv-bevrow-foot">
          <span className="body bv-meta bv-bevrow-meta">{meta != null && meta !== '' ? meta : count > 0 ? formatRatings(count) : null}</span>
          {actions ? (
            <span className="bv-actions">
              <IconButton icon="circle-plus" label={'Rank ' + bev.name} onClick={onRank} />
              <SaveButton saved={saved} onClick={onSave} />
            </span>
          ) : null}
        </div>
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

/** Notes longer than this truncate with "See more": about four lines beside the picture, more under a photo strip. */
const NOTE_MAX = { side: 96, strip: 160 };
const NOTE_CUT = { side: 86, strip: 150 };
const firstName = (p) => ((p && p.name) || '').split(' ')[0] || (p && p.handle) || '';

/** "**Arjun** Bev'd it too", "**Arjun** and **Priya** Bev'd it too", "**Arjun**, **Priya** and 3 others Bev'd it too". */
function AlsoBevd({ people, count }) {
  const shown = people.slice(0, 2);
  const total = Math.max(count != null ? count : people.length, shown.length);
  const others = total - shown.length;
  const [a, b] = shown;
  return (
    <div className="bv-post-also">
      <AvatarStack people={shown} size={24} max={2} />
      <p className="caption bv-meta bv-post-also-text">
        <b>{firstName(a)}</b>
        {b ? (others > 0 ? ', ' : ' and ') : null}
        {b ? <b>{firstName(b)}</b> : null}
        {others > 0 ? ' and ' + others + (others === 1 ? ' other' : ' others') : null}
        {" Bev'd it too"}
      </p>
    </div>
  );
}

/**
 * A ranking in the Feed and on Profile › Activity. Names bold, verb regular.
 * With the Bev's own picture the note sits beside it; with the ranker's photos (`photos`) the strip
 * scrolls and the note follows. Double-tap anywhere outside the picture likes it (never unlikes); the
 * heart in the action row is the way to unlike.
 */
export function FeedPost({ actor = {}, you = false, bev, score, scoreVariant, note, time, saved = false, liked = false, likeCount = 0, comments = [], commentCount = 0, photos, alsoBevdBy = [], alsoBevdCount, following = false, onFollow, onRank, onSave, onLike, onComment, onOpen, divider = true, className }) {
  const [open, setOpen] = React.useState(false);
  const [burst, setBurst] = React.useState(0);
  const cat = categoryById(bev.category);
  // No `photos`: the Bev's own picture, beside the note. `photos`: the ranker's own, as a strip ([] draws none).
  const side = !photos;
  const tiles = photos || [];
  const max = side ? NOTE_MAX.side : NOTE_MAX.strip;
  const cutAt = side ? NOTE_CUT.side : NOTE_CUT.strip;
  const onDoubleClick = (e) => {
    // A read-only post (no onLike: Explore, a stranger's Activity) has no double-tap at all.
    if (!onLike) return;
    // The picture keeps single tap = open the Bev; buttons keep their own action.
    if (e.target.closest && e.target.closest('.bv-post-strip, button')) return;
    setBurst((n) => n + 1);
    if (!liked) onLike();
  };
  const noteEl = note ? (
    <p className="bodyLarge bv-post-note">
      {open || note.length <= max ? note : note.slice(0, cutAt).replace(/\s+\S*$/, '') + ' … '}
      {!open && note.length > max ? <button type="button" className="bv-seemore" onClick={() => setOpen(true)}>See more</button> : null}
    </p>
  ) : null;
  // The Bevi score the ranker's own score can be read against. Left out until the Bev has one.
  const bevi = bev.bayesScore != null
    ? <p className="caption bv-meta bv-post-bevi">{formatScore(bev.bayesScore) + ' on Bevi' + (bev.ratingCount > 0 ? ' · ' + formatRatings(bev.ratingCount) : '')}</p>
    : null;
  const social = onFollow || onLike || onComment;
  const own = onRank || onSave;
  return (
    <article className={cx('bv', 'bv-post', divider && 'bv-divider', className)} onDoubleClick={onDoubleClick}>
      <div className="bv-post-head">
        <Avatar name={actor.name} src={actor.src} size={44} />
        <div className="bv-post-head-text">
          <p className="heading bv-post-line">
            <b>{you ? 'You' : firstName(actor)}</b>
            <span className="bv-post-verb">{" Bev'd "}</span>
            <b>{bev.name}</b>
          </p>
          <p className="body bv-meta bv-post-meta">
            {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} /> : null}
            <span className="bv-post-meta-text">{[bev.brand || (cat ? cat.label : ''), time].filter(Boolean).join(' · ')}</span>
          </p>
        </div>
        {score != null || scoreVariant ? <ScoreBubble score={score} variant={scoreVariant} className="bv-post-score" /> : null}
      </div>
      {side ? (
        <div className="bv-post-media bv-post-body">
          <button type="button" className="bv-post-tile" onClick={onOpen} aria-label={'Open ' + bev.name}>
            <BevImage size={112} src={bev.src} art={bev.art} alt={bev.name} />
          </button>
          <div className="bv-post-side">
            {noteEl}
            {bevi}
          </div>
          {burst ? <LikeBurst key={burst} /> : null}
        </div>
      ) : (
        <>
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
          {noteEl}
          {bevi}
        </>
      )}
      {alsoBevdBy && alsoBevdBy.length ? <AlsoBevd people={alsoBevdBy} count={alsoBevdCount} /> : null}
      {social || own ? (
        <div className="bv-post-foot">
          <span className="bv-post-social">
            {/* The author's Follow pill (Explore): UserRow's pill, leading the row where the heart sits on a feed post. */}
            {onFollow ? <FollowPill following={following} onClick={onFollow} label={'Follow ' + (actor.name || actor.handle || '')} /> : null}
            {onLike ? <LikeButton liked={liked} count={likeCount} onClick={onLike} /> : null}
            {onComment ? <CommentButton count={commentCount} onClick={onComment} /> : null}
          </span>
          {own ? (
            <span className="bv-actions">
              {onRank ? <IconButton icon="circle-plus" label={'Rank ' + bev.name} onClick={onRank} /> : null}
              {onSave ? <SaveButton saved={saved} onClick={onSave} /> : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {commentCount > INLINE_COMMENTS ? (
        <button type="button" className="body bv-post-allcomments" onClick={onComment}>{'View all ' + commentCount + ' comments'}</button>
      ) : comments.length ? (
        <ul className="bv-post-comments" aria-label="Comments">
          {comments.slice(0, INLINE_COMMENTS).map((c, i) => (
            <li key={c.id || i} className="bv-post-comment">
              <Avatar name={(c.author && (c.author.name || c.author.handle)) || ''} src={c.author && c.author.src} size={24} />
              <p className="body bv-post-comment-text"><b>{(c.author && c.author.handle) || ''}</b> {c.body}</p>
            </li>
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

/**
 * Bev'd's progress line under the filters: "Soda · 4 of 61 tried · 6%" over a 4pt `primary` bar.
 * With `onClick` it is a button (chevron right) that opens the CollectionSheet.
 */
export function ProgressStrip({ label = 'All Bevs', ranked = 0, total = 0, onClick, className }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cx('bv', 'bv-progress', className)}
      onClick={onClick}
      aria-label={onClick ? label + ', ' + spokenTried(ranked, total) + '. Show your collection' : undefined}
    >
      {onClick ? null : <span className="bv-sr-only">{label + ', ' + spokenTried(ranked, total)}</span>}
      <span className="bv-progress-top" aria-hidden={onClick ? undefined : 'true'}>
        <span className="body bv-progress-text">{label} · {formatTried(ranked, total)}</span>
        {onClick ? <Icon name="chevron-right" size={20} strokeWidth={2} className="bv-progress-chev" /> : null}
      </span>
      <ProgressBar value={total > 0 ? ranked / total : 0} />
    </Tag>
  );
}

const BAND_TONE = { high: 'scoreHigh', mid: 'scoreMid', low: 'scoreLow' };

/**
 * One category of a Taste Profile: icon and label, "8.1 · 9 ranked" (the score in its band colour) and a
 * 4pt bar filled to mean / 10 in the same colour. Not interactive; the spoken label says the numbers.
 */
export function TasteBar({ categoryId, mean, rankingCount, className }) {
  const cat = categoryById(categoryId);
  const label = cat ? cat.label : categoryId;
  const band = scoreBand(mean);
  const score = formatScore(mean);
  return (
    <div className={cx('bv', 'bv-taste-bar', 'bv-band-' + band, className)}>
      <span className="bv-sr-only">{label + ', average ' + score + ', ' + rankingCount + ' ranked'}</span>
      <span className="bv-taste-top" aria-hidden="true">
        <span className="body bv-taste-label">
          {cat ? <Icon name={cat.icon} size={20} strokeWidth={1.75} /> : null}
          <span className="bv-taste-name">{label}</span>
        </span>
        <span className="body bv-taste-value"><span className="bv-taste-score">{score}</span>{' · ' + rankingCount + ' ranked'}</span>
      </span>
      <ProgressBar value={mean / 10} tone={BAND_TONE[band]} />
    </div>
  );
}

/**
 * The Taste Profile tab's block: an optional one-line read-out ("You prefer coffee and boba over soda")
 * over a TasteBar per category. The app sorts the rows and writes the read-out; this only draws them.
 */
export function TasteProfile({ rows = [], readout, className }) {
  if (!rows.length) return null;
  return (
    <section className={cx('bv', 'bv-taste', className)}>
      {readout ? <p className="body bv-taste-readout">{readout}</p> : null}
      <div className="bv-taste-list">
        {rows.map((r) => <TasteBar key={r.categoryId} categoryId={r.categoryId} mean={r.mean} rankingCount={r.rankingCount} />)}
      </div>
    </section>
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

const BEV_OF_LABEL = { day: 'Bev of the day', week: 'Bev of the week', both: 'Bev of the day and week' };

/**
 * Bev of the day / Bev of the week: half of a pair under the Feed's search bar. Just the Bev, not a
 * post: a caps label, its square tile, its name and the score it won with. `date` ("Oct 17",
 * "Week of Oct 12") shows only when the winner is from an earlier period. `period="both"` is the one
 * card the Feed shows when the same Bev won the day and the week ("Bev of the day and week"), at the
 * width one card of the pair has.
 */
export function BevOfCard({ period = 'day', bev, score, date, onClick, className }) {
  const label = BEV_OF_LABEL[period] || BEV_OF_LABEL.day;
  const spoken = label + ': ' + bev.name + (score != null ? ', ' + formatScore(score) : '') + (date ? ', ' + date : '');
  return (
    <button type="button" className={cx('bv', 'bv-bevof', period === 'both' && 'bv-bevof-both', className)} onClick={onClick} aria-label={spoken}>
      <span className="sectionCaps bv-bevof-label">{label}</span>
      <BevImage size={164} src={bev.src} art={bev.art} status={bev.photoStatus} />
      <span className="bv-bevof-foot">
        <span className="heading bv-bevof-name">{bev.name}</span>
        <ScoreBubble score={score} />
      </span>
      {date ? <span className="caption bv-bevof-date">{date}</span> : null}
    </button>
  );
}

/**
 * Person row for People search, suggestions, followers and the points ranking. `context` adds a third
 * line under the handle ("Followed by Sam and Arjun") and the row grows from 64 to 72pt.
 */
export function UserRow({ user = {}, rank, meta, streak, context, following, self = false, onFollow, onClick, divider = true, className }) {
  return (
    <div className={cx('bv', 'bv-userrow', context && 'bv-userrow-tall', divider && 'bv-divider', self && 'bv-userrow-self', className)}>
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
          {context ? (
            <span className="caption bv-userrow-context">
              <Icon name="users" size={14} strokeWidth={2} />
              <span className="bv-userrow-context-text">{context}</span>
            </span>
          ) : null}
        </span>
      </button>
      {following != null && !self ? <FollowPill following={following} onClick={onFollow} /> : null}
    </div>
  );
}
