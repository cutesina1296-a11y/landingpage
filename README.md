# Money Hub admin setup

The public site stays on GitHub Pages. The private admin API runs on Render and saves settings and images in MongoDB Atlas.

The repository root contains a Yarn/npm workspace manifest so Render can install and start the backend even when its service root directory is left at the repository root. For a Render service configured with the backend as its root directory, use `npm install` as the build command and `npm start` as the start command.

## Run locally

1. The backend reads environment variables from the project-root `.env` file. The local site preview below deliberately blocks dotfiles from HTTP access.
2. Fill in `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in that file. Use a unique admin password and a random session secret of at least 32 characters.
3. Set `ALLOWED_ORIGIN=http://127.0.0.1:5500` for the local website preview.
4. In the `backend` folder, run `npm install`, then `npm run start:site` to serve the local website on port 5500. In another terminal, run `npm start` to launch the API on port 3000.
5. `config.js` automatically points to the local API on localhost. Open `http://127.0.0.1:5500/admin.html`.

Keep `.env` out of any public GitHub repository and remove it before publishing the site. The local preview server blocks dotfiles, but GitHub Pages does not treat `.env` as secret.

## Deploy

1. Create a MongoDB Atlas database and a database user. Allow the Render service to connect, then copy the database connection string.
2. Push this project to a GitHub repository and create a Render Blueprint from that repository using `render.yaml`.
3. In Render, set `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ALLOWED_ORIGIN` for the API service. `ALLOWED_ORIGIN` must be the exact HTTPS origin of the GitHub Pages site, such as `https://username.github.io` (include the repository path only if it is part of the origin, which it normally is not).
4. Deploy the Render service and copy its HTTPS URL.
5. Set `window.MONEY_HUB_API` in `config.js` to that Render URL, for example `https://money-hub-admin-api.onrender.com`. Commit and push the changes so GitHub Pages redeploys.
6. Open `https://username.github.io/repository/admin.html`, sign in with the Render admin credentials, and save the Telegram link, logo, and screenshots.

The API keeps image files in MongoDB GridFS. Configure a strong, unique admin password and never put database credentials or the Render session secret in frontend files.
