// Routing and the place route's body, kept out of index.ts so test.ts can
// import them: index.ts calls `Deno.serve` when it loads. Pure.

import { ticketNumber } from "./ticket.ts";

export type Route = "report" | "status" | "verify" | "place";

/** The route from the request path, whichever host prefix the gateway used. */
export function routeOf(pathname: string): Route | null {
  const path = pathname.replace(/\/+$/, "");
  if (path.endsWith("/bug-report")) return "report";
  if (path.endsWith("/bug-report/status")) return "status";
  if (path.endsWith("/bug-report/verify")) return "verify";
  if (path.endsWith("/bug-report/place")) return "place";
  return null;
}

/** The one method each route answers. */
export function methodFor(route: Route): "GET" | "POST" {
  return route === "status" ? "GET" : "POST";
}

export type PlaceRequest = { ticketId: string; afterTicketId: string | null } | { field: "ticketId" | "afterTicketId" };

/**
 * `{ ticketId, afterTicketId }`, both ticket identifiers by the same test the
 * verify route uses; `afterTicketId` may be null (or absent: the top). A
 * ticket placed after itself is refused on `afterTicketId`.
 */
export function parsePlace(raw: Record<string, unknown>): PlaceRequest {
  const ticketId = typeof raw.ticketId === "string" ? raw.ticketId.trim() : "";
  if (!ticketId || ticketNumber(ticketId) === null) return { field: "ticketId" };
  if (raw.afterTicketId === null || raw.afterTicketId === undefined) return { ticketId, afterTicketId: null };
  const afterTicketId = typeof raw.afterTicketId === "string" ? raw.afterTicketId.trim() : "";
  if (!afterTicketId || ticketNumber(afterTicketId) === null) return { field: "afterTicketId" };
  if (afterTicketId === ticketId) return { field: "afterTicketId" };
  return { ticketId, afterTicketId };
}
