// Where an opened push goes (T-31 Release 2). A push's `data.url` comes from outside the app, so it
// is never handed to the router as it is: it must be one of the in-app routes the sender writes
// (supabase/functions/send-push, `routeFor`), and anything else opens Notifications.

/** A post: its id is a feed event's, a bigint. `?comments=1` (a comment push) opens the comments. */
export const POST_ROUTE = /^\/post\/(\d{1,19})(\?comments=1)?$/;
/** A person (a follow push): a profile id, a uuid. */
export const USER_ROUTE = /^\/user\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const NOTIFICATIONS_ROUTE = '/notifications';

/** A route the router can be given: the typed form, built here from what matched, never the string itself. */
export type PushRoute =
  | { pathname: '/post/[id]'; params: { id: string; comments?: '1' } }
  | { pathname: '/user/[id]'; params: { id: string } }
  | { pathname: '/notifications' };

const INBOX: PushRoute = { pathname: NOTIFICATIONS_ROUTE };

/** The route a push's `data.url` opens: a post, a person, or Notifications for anything else. */
export function pushRoute(url: unknown): PushRoute {
  if (typeof url !== 'string' || url.length > 200) return INBOX;
  const post = POST_ROUTE.exec(url);
  if (post) return { pathname: '/post/[id]', params: post[2] ? { id: post[1]!, comments: '1' } : { id: post[1]! } };
  const user = USER_ROUTE.exec(url);
  if (user) return { pathname: '/user/[id]', params: { id: user[1]!.toLowerCase() } };
  return INBOX;
}
