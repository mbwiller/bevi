import React from 'react';
import { cx, Icon, formatScore } from './core.jsx';
import { ScoreBubble, Pill, FilterPill, IconButton, Skeleton } from './primitives.jsx';
import { SectionHeader, BevRow } from './rows.jsx';
import { EmptyState, ErrorState } from './flow.jsx';

// The venue map (TASKS.md M-16, §1c): Beli's map chrome on a live Google map of New York City.
// Parked on 2026-11-11 with the navigation redesign: the map left the Search tab (now Add Bev) and no screen composes these.
// They stay so the map can return. The Map tab's own art is FindBevArt (flow.jsx).
// The map is the one place Bevi lets things float: callouts and controls sit on `elevation-floating`.

const KIND_ICON = { chain: 'store', craft: 'coffee' };
const KIND_LABEL = { chain: 'Chain', craft: 'Craft' };

/** "Open now", "Closed", or "Hours unknown" when the hours couldn't be read (never "closed"). */
export const openLabel = (openNow) => (openNow == null ? 'Hours unknown' : openNow ? 'Open now' : 'Closed');
const bevCount = (n) => n + (n === 1 ? ' Bev' : ' Bevs');

/**
 * A venue's pin: a white callout with a grape circle holding the venue kind's glyph and the score in bold, over a small tail.
 * `predicted` = dotted ring and "~"; no score = "–". `selected` raises it and grows it.
 */
export function MapCallout({ score, predicted = false, kind = 'craft', icon, selected = false, badge, label, onClick, className }) {
  const has = score != null;
  const spoken = label || KIND_LABEL[kind] + ', ' + (has ? (predicted ? 'predicted score ' : 'score ') + formatScore(score) : 'no score yet');
  return (
    <button
      type="button"
      className={cx('bv', 'bv-callout', selected && 'bv-callout-selected', has && predicted && 'bv-callout-predicted', !has && 'bv-callout-empty', className)}
      aria-label={spoken}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="bv-callout-body">
        <span className="bv-callout-glyph"><Icon name={icon || KIND_ICON[kind]} size={16} strokeWidth={2} /></span>
        <span className="heading bv-callout-num">{has ? (predicted ? '~' : '') + formatScore(score) : '–'}</span>
        {badge ? <span className="bv-callout-badge">{badge}</span> : null}
      </span>
      <span className="bv-callout-tail" aria-hidden="true" />
    </button>
  );
}

/**
 * The row of filters over the map, scrolling sideways: Filters N, Neighborhood, Category, price, Open now, Retailer.
 * A facet's prop is the label of what is picked ('' for nothing); `neighborhoods={false}` leaves that pill out.
 */
export function MapFilterRow({
  count = 0, neighborhoods = true, neighborhood = '', category = '', price = '', retailer = '', openNow = false,
  onFilters, onNeighborhood, onCategory, onPrice, onRetailer, onOpenNow, className,
}) {
  const facet = (picked, name, onClick) => (
    <Pill variant="outlined" iconRight="chevron-down" active={!!picked} onClick={onClick} aria-haspopup="dialog" aria-label={picked ? name + ': ' + picked : name}>
      {picked || name}
    </Pill>
  );
  return (
    <div className={cx('bv', 'bv-mapfilters', className)} role="toolbar" aria-label="Map filters">
      <FilterPill label="Filters" count={count} onClick={onFilters} />
      {neighborhoods ? facet(neighborhood, 'Neighborhood', onNeighborhood) : null}
      {facet(category, 'Category', onCategory)}
      {facet(price, 'Price', onPrice)}
      <Pill variant="outlined" active={openNow} onClick={onOpenNow}>Open now</Pill>
      {facet(retailer, 'Retailer', onRetailer)}
    </div>
  );
}

/** A 44pt round floating button over the map (locate, open the full map, close). */
function MapButton({ icon, label, onClick, active = false, busy = false }) {
  return (
    <button type="button" className={cx('bv-mapbtn', active && 'bv-mapbtn-active')} aria-label={label} aria-busy={busy || undefined} onClick={onClick}>
      <Icon name={icon} size={22} strokeWidth={2} />
    </button>
  );
}

/**
 * The map's floating controls. Inline (under the search bar): the filter row, and "open the full map" over `View List` at the
 * bottom right. Full screen (`expanded`): `List | Map` and the close button on top, the filter row under them, and the locate
 * button over `View List`. Pass the MapFilterRow as `children`.
 */
export function MapControls({ expanded = false, mode = 'map', onModeChange, onExpand, onClose, onLocate, located = false, locating = false, onViewList, children, className }) {
  const seg = (id, icon, text) => (
    <button type="button" role="radio" aria-checked={mode === id} className={cx('bv-mapseg-opt', mode === id && 'bv-mapseg-on')} onClick={() => onModeChange && onModeChange(id)}>
      <Icon name={icon} size={18} strokeWidth={2} />
      <span>{text}</span>
    </button>
  );
  return (
    <div className={cx('bv', 'bv-mapctl', expanded && 'bv-mapctl-full', className)}>
      <div className="bv-mapctl-top">
        {expanded ? (
          <div className="bv-mapctl-bar">
            <span className="bv-mapctl-spacer" />
            <div className="bv-mapseg" role="radiogroup" aria-label="Show spots as">{seg('list', 'list', 'List')}{seg('map', 'map-pin', 'Map')}</div>
            <MapButton icon="x" label="Close map" onClick={onClose} />
          </div>
        ) : null}
        {children}
      </div>
      {mode === 'map' ? (
        <div className="bv-mapctl-corner">
          {expanded
            ? <MapButton icon="navigation" label="Show where I am" onClick={onLocate} active={located} busy={locating} />
            : <MapButton icon="maximize-2" label="Open the full map" onClick={onExpand} />}
          <button type="button" className="bv-viewlist heading" onClick={onViewList}>
            <Icon name="list" size={20} strokeWidth={2} />
            <span>View List</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A venue in the map's List view: name, kind and neighborhood, open state and Bev count, and the pin's score. */
export function VenueRow({ venue, openNow = null, score, predicted = false, bevs = 1, divider = true, onClick, className }) {
  const meta = [KIND_LABEL[venue.kind], venue.neighborhood].filter(Boolean).join(' · ');
  return (
    <button type="button" className={cx('bv', 'bv-venuerow', divider && 'bv-divider', className)} onClick={onClick}>
      <span className="bv-venuerow-text">
        <span className="heading bv-venuerow-name">{venue.name}</span>
        <span className="body bv-meta">{meta}</span>
        <span className="body bv-meta">{openLabel(openNow) + ' · ' + bevCount(bevs)}</span>
      </span>
      {score != null ? <ScoreBubble score={score} variant={predicted ? 'predicted' : 'default'} /> : null}
    </button>
  );
}

/**
 * The tapped venue, docked under the full-screen map (the map shrinks above it, so its pin, Google's logo and the
 * OpenStreetMap credit stay in view): name, kind · neighborhood · borough, open state, address, website, then
 * "Bevs here (N)" as BevRows with Rank it and Want to Try, and the OpenStreetMap credit.
 */
export function VenueSheet({ venue, openNow = null, bevs = [], bevCount: count, loading = false, notFound = false, error, onClose, onRetry, onRank, onSave, onOpenBev, onWebsite, className }) {
  const meta = venue ? [KIND_LABEL[venue.kind], venue.neighborhood, venue.borough].filter(Boolean).join(' · ') : '';
  // Only http(s) websites (the value comes from OpenStreetMap): never a `javascript:` URL or a bare word.
  const site = venue && venue.website && /^https?:\/\/[^\s/]+/i.test(venue.website.trim()) ? venue.website.trim() : null;
  const host = site ? site.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '') : null;
  const n = count != null ? count : bevs.length;
  let body;
  if (notFound) body = <EmptyState icon="map-pin" title="This spot isn't here anymore" body="It may have closed, or it no longer carries any Bevs." />;
  else if (error) body = <ErrorState title={error} onRetry={onRetry} />;
  else body = (
    <>
      <SectionHeader title={'Bevs here (' + n + ')'} />
      {loading
        ? <div aria-busy="true" aria-label="Loading Bevs"><Skeleton variant="row" /><Skeleton variant="row" /></div>
        : bevs.length
          ? bevs.map((r, i) => <BevRow key={i} bev={r.bev} score={r.score} scoreVariant={r.scoreVariant} meta={r.meta} count={r.count} saved={r.saved} showImage onRank={() => onRank && onRank(r)} onSave={() => onSave && onSave(r)} onClick={() => onOpenBev && onOpenBev(r)} />)
          : <EmptyState icon="cup-soda" title="No Bevs listed here yet" body="Spots show up on the map once we know what they carry." />}
    </>
  );
  return (
    <section className={cx('bv', 'bv-venuesheet', className)} aria-label={venue ? venue.name : 'Spot'}>
      <span className="bv-sheet-handle" aria-hidden="true" />
      <div className="bv-venuesheet-scroll">
        {venue && !notFound ? (
          <div className="bv-venuesheet-head">
            <div className="bv-venuesheet-title">
              <h2 className="screenTitle">{venue.name}</h2>
              <IconButton icon="x" variant="filled" label="Close" onClick={onClose} />
            </div>
            {meta ? <p className="body bv-meta">{meta}</p> : null}
            <p className="body bv-venuesheet-line"><Icon name="clock" size={16} strokeWidth={2} /><span>{openLabel(openNow)}</span></p>
            {venue.address ? <p className="body bv-venuesheet-line"><Icon name="map-pin" size={16} strokeWidth={2} /><span>{venue.address}</span></p> : null}
            {host ? <a className="body bv-link bv-venuesheet-web" href={site} target="_blank" rel="noopener noreferrer" onClick={onWebsite}>{host}</a> : null}
          </div>
        ) : (
          <div className="bv-venuesheet-title bv-venuesheet-title-end"><IconButton icon="x" variant="filled" label="Close" onClick={onClose} /></div>
        )}
        {body}
        <p className="caption bv-meta bv-venuesheet-osm">© OpenStreetMap contributors</p>
      </div>
    </section>
  );
}
