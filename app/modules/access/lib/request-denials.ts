import { data } from "react-router";

const SIGNED_OUT_MESSAGE = "Select a user from the DevUI panel.";

/** Shared by both Request adapters so their signed-out message cannot diverge. */
export function signedOutDenial() {
  return data(SIGNED_OUT_MESSAGE, { status: 401 });
}
