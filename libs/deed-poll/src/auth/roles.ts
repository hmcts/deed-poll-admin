/**
 * Role identifiers. The single privileged role ports the Dynamics security role
 * "Deed Poll Admin User" — the source's admin gate for privacy editability and
 * the create-time privacy auto-default (see FormPresentationService).
 */
export const DEEDPOLL_ADMIN = "deedpoll-admin";

/** All roles a request may carry. Extend as further roles are modelled. */
export type Role = typeof DEEDPOLL_ADMIN;
