import type { NotificationSettings } from '@bevi/shared';

import {
  applySettingToggle,
  DEFAULT_SETTINGS,
  NOTIFICATION_KINDS,
  shownAs,
  type NotificationSettingKey,
} from '../settingsRules';

const S = (over: Partial<NotificationSettings> = {}): NotificationSettings => ({ ...DEFAULT_SETTINGS, ...over });
const shown = (s: NotificationSettings) =>
  Object.fromEntries((['paused', ...NOTIFICATION_KINDS] as NotificationSettingKey[]).map((k) => [k, shownAs(s, k)]));

describe('the defaults', () => {
  it('are not paused, with New followers, Likes and Comments on and Posts off', () => {
    expect(DEFAULT_SETTINGS).toEqual({ paused: false, follows: true, likes: true, comments: true, posts: false });
    expect(shown(DEFAULT_SETTINGS)).toEqual({ paused: false, follows: true, likes: true, comments: true, posts: false });
  });
});

describe('Pause all', () => {
  it('on: paused, the kinds kept as they are, and every kind shows off', () => {
    const before = S({ likes: false, posts: true });
    const after = applySettingToggle(before, 'paused', true);
    expect(after).toEqual({ paused: true, follows: true, likes: false, comments: true, posts: true });
    expect(shown(after)).toEqual({ paused: true, follows: false, likes: false, comments: false, posts: false });
  });

  it('off: each kind back exactly as it was, a mixed state with Posts off included', () => {
    const mixed = S({ follows: true, likes: false, comments: true, posts: false });
    const back = applySettingToggle(applySettingToggle(mixed, 'paused', true), 'paused', false);
    expect(back).toEqual(mixed);
    expect(shown(back)).toEqual({ paused: false, follows: true, likes: false, comments: true, posts: false });
  });

  it('off: Posts is on again only if it was on before', () => {
    const withPosts = S({ posts: true });
    expect(applySettingToggle(applySettingToggle(withPosts, 'paused', true), 'paused', false).posts).toBe(true);
    expect(applySettingToggle(applySettingToggle(S(), 'paused', true), 'paused', false).posts).toBe(false);
  });

  it('on twice, or off while not paused, changes nothing else', () => {
    expect(applySettingToggle(S({ paused: true }), 'paused', true)).toEqual(S({ paused: true }));
    expect(applySettingToggle(S(), 'paused', false)).toEqual(S());
  });
});

describe('a kind switched while not paused', () => {
  it.each(NOTIFICATION_KINDS)('%s off: just that flag', (kind) => {
    const all = S({ follows: true, likes: true, comments: true, posts: true });
    expect(applySettingToggle(all, kind, false)).toEqual({ ...all, [kind]: false });
  });

  it.each(NOTIFICATION_KINDS)('%s on: just that flag', (kind) => {
    const none = S({ follows: false, likes: false, comments: false, posts: false });
    expect(applySettingToggle(none, kind, true)).toEqual({ ...none, [kind]: true });
  });

  it('never changes its argument', () => {
    const before = S();
    const copy = { ...before };
    applySettingToggle(before, 'likes', false);
    applySettingToggle(before, 'paused', true);
    expect(before).toEqual(copy);
  });
});

describe('a kind switched on while paused', () => {
  it.each(NOTIFICATION_KINDS)('%s: the pause ends with only that kind on', (kind) => {
    const paused = S({ paused: true, follows: true, likes: true, comments: false, posts: true });
    const after = applySettingToggle(paused, kind, true);
    expect(after).toEqual({ paused: false, follows: false, likes: false, comments: false, posts: false, [kind]: true });
    expect(shown(after)).toEqual({ paused: false, follows: false, likes: false, comments: false, posts: false, [kind]: true });
  });

  it('then unpausing has nothing to restore: the old kinds are gone', () => {
    const paused = S({ paused: true });
    const after = applySettingToggle(paused, 'comments', true);
    expect(applySettingToggle(after, 'paused', false)).toEqual({ paused: false, follows: false, likes: false, comments: true, posts: false });
  });

  it('a kind switched off while paused just changes that (hidden) flag and stays paused', () => {
    const paused = S({ paused: true });
    expect(applySettingToggle(paused, 'likes', false)).toEqual({ ...paused, likes: false });
  });
});

describe('a person chosen in Post notifications (Posts switched on, when it does not show on)', () => {
  it('turns Posts on when it was off', () => {
    expect(applySettingToggle(S(), 'posts', true)).toEqual(S({ posts: true }));
  });

  it('ends a pause with only Posts on', () => {
    expect(applySettingToggle(S({ paused: true, posts: true }), 'posts', true)).toEqual({
      paused: false,
      follows: false,
      likes: false,
      comments: false,
      posts: true,
    });
  });
});
