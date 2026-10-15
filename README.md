# Money Hub

Money Hub is a responsive landing page served by the same Node.js service as its private admin API. Site settings and uploaded images are stored in MongoDB Atlas.

## Run locally

1. Create a project-root `.env` file with `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET`. Use a unique admin password and a random session secret of at least 32 characters.
2. Set `ALLOWED_ORIGIN=http://127.0.0.1:5500` in `.env`.
3. Run `npm install` from the repository root.
4. In one terminal, run `npm start` to start the API on port 3000. In another, run `npm run start:site` to serve the local website on port 5500.
5. Open `http://127.0.0.1:5500` for the landing page or `http://127.0.0.1:5500/admin.html` to manage the Telegram link and images.

Keep `.env` out of any public GitHub repository. The local preview server blocks dotfiles and the backend only serves the site's public pages and upload directory.

## Deploy to Render

1. Create a MongoDB Atlas database and database user. Allow the Render service to connect and copy the database connection string.
2. Push the project to GitHub and create a Render Blueprint from the repository using `render.yaml`.
3. In Render, set `MONGODB_URI`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` for the `money-hub` service. Render generates `SESSION_SECRET`; the API uses Render's external URL as its same-origin setting.
4. Deploy the service. The landing page, admin page, and API will all be available on the service's HTTPS URL.
5. Open `https://<your-render-service>.onrender.com/admin.html`, sign in with the Render admin credentials, and save the Telegram link, logo, and screenshots.

The API stores uploaded image files in MongoDB GridFS. Never put database credentials, the admin password, or the Render session secret in frontend files.
