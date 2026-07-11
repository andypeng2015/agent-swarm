import type { IncomingMessage } from "node:http";
import { resolveHttpAuditUserId } from "../be/audit-user";
import { getRequestAuth } from "../utils/request-auth-context";

export type FavoriteOwner = {
  scope: string;
  userId: string | null;
  actorId: string;
};

/**
 * Resolve the authenticated principal that owns favorite state.
 *
 * The hosted dashboard authenticates with the deployment's operator key,
 * while end-user REST clients authenticate with user-bound `aswt_` tokens.
 * Both are trusted principals, but only the latter has a canonical users row.
 */
export function resolveHttpFavoriteOwner(
  req: IncomingMessage,
  callerAgentId: string | undefined,
): FavoriteOwner | null {
  const auth = getRequestAuth(req);
  if (auth?.kind === "user") {
    return { scope: `user:${auth.userId}`, userId: auth.userId, actorId: auth.userId };
  }
  if (auth?.kind === "operator") {
    return {
      // A deployment has one configured operator key. Keep its dashboard
      // favorites stable across key rotation; the fingerprint remains the
      // audit actor, not the storage scope.
      scope: "operator",
      userId: null,
      actorId: auth.fingerprint,
    };
  }

  const userId = resolveHttpAuditUserId(req, callerAgentId);
  return userId ? { scope: `user:${userId}`, userId, actorId: userId } : null;
}
