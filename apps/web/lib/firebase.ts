/**
 * Identity Platform (Firebase Auth) client — sign-in only.
 *
 * This app never talks to Firestore/Storage from the browser; the only job
 * here is to sign the user in and hand back a fresh ID token, which
 * `AuthGate` exchanges for our own httpOnly session cookie via
 * POST /api/auth/session. The config below is the public web API key — it
 * identifies the Firebase project, it is not a secret (Identity Platform
 * enforces access via the sign-in methods you enable, not by hiding this
 * key: https://firebase.google.com/docs/projects/api-keys).
 */

import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

function app() {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

/** Sign in with email/password, return a fresh ID token to exchange for a session cookie. */
export async function signInWithPassword(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(getAuth(app()), email, password);
  return credential.user.getIdToken();
}

/**
 * Start Firebase's built-in password change flow: Identity Platform emails
 * `email` a link to its hosted page, where the user picks a new password.
 * `languageCode` sets the language of that email and page.
 *
 * Changing the password revokes the account's refresh tokens, so the API's
 * revocation check then rejects the current session cookie and the app drops
 * back to the login screen on its next request.
 */
export function sendPasswordReset(email: string, languageCode: string): Promise<void> {
  const auth = getAuth(app());
  auth.languageCode = languageCode;
  return sendPasswordResetEmail(auth, email);
}

/** Drop the client-side Firebase session (in addition to clearing our own cookie). */
export function signOut(): Promise<void> {
  return firebaseSignOut(getAuth(app()));
}
