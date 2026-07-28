# Scrum Poker Demo

This project is a lightweight Scrum Poker app designed to run on GitHub Pages with no custom domain required.

## Run locally

1. Install Node.js 20+
2. Run `npm install`
3. Run `npm run dev`

## Enable shared rooms

Browser storage is device-local, so shared rooms require Firebase Realtime Database.
Create a Firebase project, register a Web app, and create a Realtime Database. Start
in test mode for development, or configure rules that allow access to the rooms you
intend to share.

For this no-login demo, the Realtime Database Rules tab can use the following rules.
They make room data publicly readable and writable, so replace them with authenticated
and validated rules before using the app with sensitive data:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

For local development, copy `.env.example` to `.env.local` and set:

```
VITE_FIREBASE_API_KEY=<web-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_APP_ID=<web-app-id>
```

For GitHub Pages, add the same values as repository Actions secrets named
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`,
`VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`. The deployment workflow passes
them to Vite during the build. Firebase web configuration is public; never use an
Admin SDK private key in the browser.

Without this setup, the app clearly reports that changes are saved only on the current
device and does not let participants join a room that is not locally available.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open the repository Settings > Pages.
3. Choose GitHub Actions as the source.
4. The workflow in `.github/workflows/deploy.yml` will build and publish the app automatically.

App will be available at:

https://kedharnadh.github.io/Open-Scrum-Poker/
