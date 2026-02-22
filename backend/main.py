from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List, Optional
import aiosqlite
import os
import uuid
from datetime import datetime, date
from pathlib import Path
import shutil
import json

app = FastAPI(title="Japan Journal API")

# Auth configuration
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "")

def verify_token(authorization: Optional[str] = Header(None)):
    """Verify the auth token for protected routes"""
    if not AUTH_TOKEN:
        return  # No auth configured, allow all
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    # Accept "Bearer <token>" or just "<token>"
    token = authorization.replace("Bearer ", "").strip()
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "/app/data/journal.db")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path(DATABASE_URL).parent.mkdir(parents=True, exist_ok=True)

# Database initialization
async def init_db():
    async with aiosqlite.connect(DATABASE_URL) as db:
        # Check if old photos table exists (need to migrate)
        needs_migration = False
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='photos'") as cursor:
            if await cursor.fetchone():
                needs_migration = True

        # Add new columns to entries if they don't exist
        for col, coltype in [("latitude", "REAL"), ("longitude", "REAL"), ("location_name", "TEXT"),
                             ("filename", "TEXT"), ("original_name", "TEXT")]:
            try:
                await db.execute(f"ALTER TABLE entries ADD COLUMN {col} {coltype}")
            except:
                pass

        if needs_migration:
            await migrate_photos_to_entries(db)

        # Create entries table for fresh installs (includes all columns)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                text TEXT,
                created_at TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                location_name TEXT,
                filename TEXT,
                original_name TEXT
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date)")
        await db.commit()


async def migrate_photos_to_entries(db):
    """Migrate from old two-table model (entries + photos) to one-entry-per-photo model."""
    # Get all photos with their entry data
    async with db.execute("""
        SELECT p.id, p.filename, p.original_name, p.location_name,
               e.date, e.text, e.created_at, e.latitude, e.longitude, e.location_name as entry_location
        FROM photos p
        JOIN entries e ON p.entry_id = e.id
        ORDER BY e.date, p.order_index
    """) as cursor:
        rows = await cursor.fetchall()

    if rows:
        # Delete old entries (we'll recreate them from photos)
        await db.execute("DELETE FROM entries")

        for row in rows:
            photo_id, filename, original_name, photo_loc, entry_date, text, created_at, lat, lng, entry_loc = row
            # Prefer photo-level location, fall back to entry-level
            location_name = photo_loc or entry_loc
            await db.execute(
                "INSERT INTO entries (id, date, text, created_at, latitude, longitude, location_name, filename, original_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (photo_id, entry_date, text, created_at, lat, lng, location_name, filename, original_name)
            )

    # Drop old photos table
    await db.execute("DROP TABLE IF EXISTS photos")
    await db.commit()


@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.post("/api/auth/verify")
async def verify_auth(authorization: Optional[str] = Header(None)):
    """Verify if the provided token is valid"""
    try:
        verify_token(authorization)
        return {"valid": True}
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/api/entries")
async def create_entry(
    date: str = Form(...),
    text: Optional[str] = Form(None),
    photo_locations: Optional[str] = Form(None),  # JSON: {"original_filename": "Location Name", ...}
    photos: List[UploadFile] = File(...),
    authorization: Optional[str] = Header(None)
):
    """Create journal entries - one per photo. Multi-select creates multiple entries."""
    verify_token(authorization)

    if len(photos) < 1 or len(photos) > 10:
        raise HTTPException(status_code=400, detail="Must upload 1-10 photos")

    # Parse per-photo locations
    locations_map = {}
    if photo_locations:
        try:
            locations_map = json.loads(photo_locations)
        except:
            pass

    created_entries = []

    async with aiosqlite.connect(DATABASE_URL) as db:
        for photo in photos:
            # Validate file type
            if not photo.content_type or not photo.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail=f"File {photo.filename} is not an image")

            # Generate unique filename
            ext = Path(photo.filename).suffix
            entry_id = str(uuid.uuid4())
            filename = f"{entry_id}{ext}"
            filepath = Path(UPLOAD_DIR) / filename
            created_at = datetime.utcnow().isoformat()

            # Save file
            with open(filepath, "wb") as buffer:
                shutil.copyfileobj(photo.file, buffer)

            location_name = locations_map.get(photo.filename)

            await db.execute(
                "INSERT INTO entries (id, date, text, created_at, filename, original_name, location_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entry_id, date, text, created_at, filename, photo.filename, location_name)
            )

            created_entries.append({
                "id": entry_id,
                "date": date,
                "text": text,
                "created_at": created_at,
                "filename": filename,
                "original_name": photo.filename,
                "location_name": location_name,
                "latitude": None,
                "longitude": None,
            })

        await db.commit()

    return created_entries

@app.get("/api/entries")
async def get_entries():
    """Get all journal entries"""
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute(
            "SELECT id, date, text, created_at, latitude, longitude, location_name, filename, original_name FROM entries ORDER BY date DESC, created_at DESC"
        ) as cursor:
            entries = []
            async for row in cursor:
                entries.append({
                    "id": row[0],
                    "date": row[1],
                    "text": row[2],
                    "created_at": row[3],
                    "latitude": row[4],
                    "longitude": row[5],
                    "location_name": row[6],
                    "filename": row[7],
                    "original_name": row[8],
                })
    return entries

@app.get("/api/entries/{entry_id}")
async def get_entry(entry_id: str):
    """Get a single journal entry"""
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute(
            "SELECT id, date, text, created_at, latitude, longitude, location_name, filename, original_name FROM entries WHERE id = ?",
            (entry_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Entry not found")

            return {
                "id": row[0],
                "date": row[1],
                "text": row[2],
                "created_at": row[3],
                "latitude": row[4],
                "longitude": row[5],
                "location_name": row[6],
                "filename": row[7],
                "original_name": row[8],
            }

@app.patch("/api/entries/{entry_id}")
async def update_entry(
    entry_id: str,
    text: Optional[str] = Form(None),
    location_name: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    authorization: Optional[str] = Header(None)
):
    """Update a journal entry - change text and/or replace photo"""
    verify_token(authorization)

    async with aiosqlite.connect(DATABASE_URL) as db:
        # Check entry exists
        async with db.execute("SELECT id, filename FROM entries WHERE id = ?", (entry_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Entry not found")
            old_filename = row[1]

        # Update text if provided
        if text is not None:
            await db.execute("UPDATE entries SET text = ? WHERE id = ?", (text, entry_id))

        if location_name is not None:
            await db.execute("UPDATE entries SET location_name = ? WHERE id = ?", (location_name, entry_id))

        # Replace photo if provided
        if photo and photo.filename:
            if not photo.content_type or not photo.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="File is not an image")

            # Delete old file
            if old_filename:
                old_path = Path(UPLOAD_DIR) / old_filename
                if old_path.exists():
                    old_path.unlink()

            # Save new file
            ext = Path(photo.filename).suffix
            new_id = str(uuid.uuid4())
            new_filename = f"{new_id}{ext}"
            filepath = Path(UPLOAD_DIR) / new_filename

            with open(filepath, "wb") as buffer:
                shutil.copyfileobj(photo.file, buffer)

            await db.execute(
                "UPDATE entries SET filename = ?, original_name = ? WHERE id = ?",
                (new_filename, photo.filename, entry_id)
            )

        await db.commit()

    # Return updated entry
    return await get_entry(entry_id)

@app.delete("/api/entries/{entry_id}")
async def delete_entry(entry_id: str, authorization: Optional[str] = Header(None)):
    """Delete a journal entry and its photo"""
    verify_token(authorization)

    async with aiosqlite.connect(DATABASE_URL) as db:
        # Get filename to delete file
        async with db.execute("SELECT filename FROM entries WHERE id = ?", (entry_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Entry not found")

            if row[0]:
                filepath = Path(UPLOAD_DIR) / row[0]
                if filepath.exists():
                    filepath.unlink()

        await db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
        await db.commit()

    return {"message": "Entry deleted"}

@app.get("/api/photos/{filename}")
async def get_photo(filename: str):
    """Serve a photo file"""
    filepath = Path(UPLOAD_DIR) / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(filepath)
