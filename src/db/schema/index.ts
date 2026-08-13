/**
 * The schema, split by domain. Everything is re-exported here because
 * drizzle-kit reads this file to decide what the database should contain —
 * a table that stops being exported is a table drizzle-kit will drop.
 */
export * from "./users";
export * from "./memberships";
export * from "./classes";
export * from "./bookings";
export * from "./companies";
export * from "./payments";
export * from "./notifications";
