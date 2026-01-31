# Japan Journal

A simple, self-hosted photo journal app for documenting your daily adventures during a trip to Japan. Post 1-5 photos per day with text descriptions.

## Features

- Post 1-5 photos daily with text descriptions
- Responsive design optimized for mobile (iPhone)
- PWA support - add to home screen for app-like experience
- Gallery view of all entries
- Lightbox for viewing full-size images
- Date-based organization
- SQLite database for simplicity
- Docker-based deployment
- Traefik integration for reverse proxy and SSL

## Tech Stack

- **Frontend**: React + Vite, served by Nginx
- **Backend**: Python FastAPI
- **Database**: SQLite
- **Storage**: Local file system
- **Deployment**: Docker Compose + Traefik

## Quick Start (Local Development)

### Prerequisites

- Docker and Docker Compose
- Node.js (for local frontend development)
- Python 3.11+ (for local backend development)

### Running Locally Without Docker

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

## Production Deployment (Home Lab with Traefik)

### Prerequisites

- Docker and Docker Compose installed on your home lab server
- Traefik reverse proxy already set up and running
- A domain name pointing to your home lab (or local DNS entry)

### Setup Steps

1. Clone this repository to your server:
```bash
git clone <your-repo-url>
cd journal-japan
```

2. Create a `.env` file with your domain:
```bash
cp .env.example .env
# Edit .env and set your domain
DOMAIN=japan.yourdomain.com
```

3. Make sure your Traefik network exists:
```bash
docker network create traefik
```

4. Build and start the containers:
```bash
docker-compose up -d --build
```

5. Check logs to ensure everything started correctly:
```bash
docker-compose logs -f
```

### Traefik Configuration

The app is pre-configured with Traefik labels in `docker-compose.yml`:

- Frontend: `https://japan.yourdomain.com`
- Backend API: `https://japan.yourdomain.com/api`

Make sure your Traefik configuration includes:
- A `websecure` entrypoint on port 443
- A certificate resolver named `letsencrypt`

Example Traefik static configuration:
```yaml
entryPoints:
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: your-email@example.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
```

### Using on Your iPhone

1. Open Safari and navigate to your domain (e.g., `https://japan.yourdomain.com`)
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Name it "Japan Journal" and tap "Add"
5. The app will now appear on your home screen like a native app!

The PWA configuration ensures:
- Full-screen mode (no browser UI)
- Custom app icon
- Offline capability for viewing existing entries
- Native-like experience

## Usage

### Adding an Entry

1. Select today's date (or any past date)
2. Write about your day in the text area
3. Click the photo upload area and select 1-5 photos
4. Click "Post Entry"

### Viewing Entries

- All entries appear in the gallery below the form
- Click any photo to view it full-size
- Entries are sorted by date (newest first)

### Deleting an Entry

- Click the "Delete Entry" button at the bottom of any entry card
- Confirm the deletion

## File Structure

```
.
├── backend/
│   ├── Dockerfile
│   ├── main.py           # FastAPI application
│   └── requirements.txt
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf        # Nginx configuration
│   ├── package.json
│   ├── public/
│   │   └── manifest.json # PWA manifest
│   └── src/
│       ├── App.jsx       # Main React component
│       ├── index.css     # Styles
│       └── main.jsx      # React entry point
├── docker-compose.yml
├── .env.example
└── README.md
```

## Data Persistence

All data is stored in local volumes:
- `./data/` - SQLite database
- `./uploads/` - Photo files

These directories are created automatically and are git-ignored. Make sure to back them up!

## Backup

To backup your journal:

```bash
# Backup database and photos
tar -czf japan-journal-backup-$(date +%Y%m%d).tar.gz data/ uploads/

# Or use rsync for incremental backups
rsync -av --progress data/ uploads/ /path/to/backup/location/
```

## Updating

To update the application:

```bash
git pull
docker-compose down
docker-compose up -d --build
```

## Troubleshooting

### Can't connect to the app
- Check that Traefik is running: `docker ps | grep traefik`
- Verify the domain is correct in `.env`
- Check container logs: `docker-compose logs`

### Photos not uploading
- Check backend logs: `docker-compose logs backend`
- Verify the uploads directory has correct permissions
- Ensure you're selecting 1-5 images

### Database errors
- Check that the data directory is writable
- View backend logs for specific error messages

## Security Notes

- This app is designed for personal use behind Traefik
- No authentication is built in - protect with Traefik BasicAuth or similar
- Consider adding CORS restrictions in production
- The app trusts all uploaded files are images - add validation as needed

## License

MIT

## Enjoy Your Trip!

Have an amazing time in Japan! 🇯🇵 🗾 ⛩️
