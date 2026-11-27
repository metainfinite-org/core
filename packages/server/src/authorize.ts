// authorize(session, app, user) (03 §7): the single seam where real signature
// checks plug in later. Demo rules:
//  - the session must control `user`: it is the user, or the IDM's custody
//    policy lets it act as that identity (e.g. the human who made an app);
//  - an identity speaking for itself in its own batch (user == app) needs no
//    grant (03 §5);
//  - otherwise the user's IDM lazily issues an auto-approved grant (03 §4),
//    and the event's `auth` points at it.

import type { Address, Id } from "@ev/core";
import type { Idm } from "@ev/idm";

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

export async function authorize(idm: Idm, session: Id | null, app: Id, user: Id): Promise<Address | null> {
  if (session === null) throw new AuthError("sign in first", 401);
  if (!(await idm.controls(session, user))) throw new AuthError(`you can't act as identity ${user}`, 403);
  if (user === app) return null;
  return idm.ensureGrant(app, user);
}
