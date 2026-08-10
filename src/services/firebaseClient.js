import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const isConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.databaseURL
  && firebaseConfig.projectId
  && firebaseConfig.appId
);

export const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const database = app ? getDatabase(app) : null;
export const auth = app ? getAuth(app) : null;

export async function ensureAuth() {
  if (!auth) {
    return null;
  }
  try {
    if (auth.currentUser) {
      return auth.currentUser;
    }
    const credentials = await signInAnonymously(auth);
    return credentials.user;
  } catch (error) {
    console.warn('Anonymous auth unavailable:', error);
    return null;
  }
}
