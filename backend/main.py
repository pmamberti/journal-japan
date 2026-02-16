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
        await db.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                text TEXT,
                created_at TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                location_name TEXT
            )
        """)
        # Add columns if they don't exist (for existing databases)
        try:
            await db.execute("ALTER TABLE entries ADD COLUMN latitude REAL")
        except:
            pass
        try:
            await db.execute("ALTER TABLE entries ADD COLUMN longitude REAL")
        except:
            pass
        try:
            await db.execute("ALTER TABLE entries ADD COLUMN location_name TEXT")
        except:
            pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                entry_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                original_name TEXT,
                order_index INTEGER NOT NULL,
                location_name TEXT,
                FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE
            )
        """)
        # Add location_name column if it doesn't exist (for existing databases)
        try:
            await db.execute("ALTER TABLE photos ADD COLUMN location_name TEXT")
        except:
            pass
        await db.execute("CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_photos_entry ON photos(entry_id)")
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
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    location_name: Optional[str] = Form(None),
    photo_locations: Optional[str] = Form(None),  # JSON: {"original_filename": "Location Name", ...}
    photos: List[UploadFile] = File(...),
    authorization: Optional[str] = Header(None)
):
    """Create a new journal entry with 1-5 photos"""
    verify_token(authorization)

    if len(photos) < 1 or len(photos) > 5:
        raise HTTPException(status_code=400, detail="Must upload 1-5 photos")

    # Validate date format
    try:
        entry_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    # Check if max entries for this date reached (limit 5 per day)
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute("SELECT COUNT(*) FROM entries WHERE date = ?", (date,)) as cursor:
            count = (await cursor.fetchone())[0]
            if count >= 5:
                raise HTTPException(status_code=400, detail="Maximum 5 entries per day reached")

    # Create entry
    entry_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()

    # Parse per-photo locations
    locations_map = {}
    if photo_locations:
        try:
            locations_map = json.loads(photo_locations)
        except:
            pass

    # Save photos
    saved_photos = []
    for idx, photo in enumerate(photos):
        # Validate file type
        if not photo.content_type or not photo.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"File {photo.filename} is not an image")

        # Generate unique filename
        ext = Path(photo.filename).suffix
        photo_id = str(uuid.uuid4())
        filename = f"{photo_id}{ext}"
        filepath = Path(UPLOAD_DIR) / filename

        # Save file
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(photo.file, buffer)

        saved_photos.append({
            "id": photo_id,
            "filename": filename,
            "original_name": photo.filename,
            "order_index": idx,
            "location_name": locations_map.get(photo.filename)
        })

    # Save to database
    async with aiosqlite.connect(DATABASE_URL) as db:
        await db.execute(
            "INSERT INTO entries (id, date, text, created_at, latitude, longitude, location_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (entry_id, date, text, created_at, latitude, longitude, location_name)
        )

        for photo in saved_photos:
            await db.execute(
                "INSERT INTO photos (id, entry_id, filename, original_name, order_index, location_name) VALUES (?, ?, ?, ?, ?, ?)",
                (photo["id"], entry_id, photo["filename"], photo["original_name"], photo["order_index"], photo["location_name"])
            )

        await db.commit()

    return {
        "id": entry_id,
        "date": date,
        "text": text,
        "created_at": created_at,
        "latitude": latitude,
        "longitude": longitude,
        "location_name": location_name,
        "photos": saved_photos
    }

@app.get("/api/entries")
async def get_entries():
    """Get all journal entries"""
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute(
            "SELECT id, date, text, created_at, latitude, longitude, location_name FROM entries ORDER BY date DESC"
        ) as cursor:
            entries = []
            async for row in cursor:
                entry = {
                    "id": row[0],
                    "date": row[1],
                    "text": row[2],
                    "created_at": row[3],
                    "latitude": row[4],
                    "longitude": row[5],
                    "location_name": row[6],
                    "photos": []
                }

                # Get photos for this entry
                async with db.execute(
                    "SELECT id, filename, original_name, order_index, location_name FROM photos WHERE entry_id = ? ORDER BY order_index",
                    (row[0],)
                ) as photo_cursor:
                    async for photo_row in photo_cursor:
                        entry["photos"].append({
                            "id": photo_row[0],
                            "filename": photo_row[1],
                            "original_name": photo_row[2],
                            "order_index": photo_row[3],
                            "location_name": photo_row[4]
                        })

                entries.append(entry)

    return entries

@app.get("/api/entries/{entry_id}")
async def get_entry(entry_id: str):
    """Get a single journal entry"""
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute(
            "SELECT id, date, text, created_at, latitude, longitude, location_name FROM entries WHERE id = ?",
            (entry_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Entry not found")

            entry = {
                "id": row[0],
                "date": row[1],
                "text": row[2],
                "created_at": row[3],
                "latitude": row[4],
                "longitude": row[5],
                "location_name": row[6],
                "photos": []
            }

            # Get photos
            async with db.execute(
                "SELECT id, filename, original_name, order_index FROM photos WHERE entry_id = ? ORDER BY order_index",
                (entry_id,)
            ) as photo_cursor:
                async for photo_row in photo_cursor:
                    entry["photos"].append({
                        "id": photo_row[0],
                        "filename": photo_row[1],
                        "original_name": photo_row[2],
                        "order_index": photo_row[3]
                    })

    return entry

@app.patch("/api/entries/{entry_id}")
async def update_entry(
    entry_id: str,
    text: Optional[str] = Form(None),
    remove_photos: Optional[str] = Form(None),  # Comma-separated photo IDs to remove
    photos: List[UploadFile] = File(None),
    authorization: Optional[str] = Header(None)
):
    """Update a journal entry - change text, add/remove photos"""
    verify_token(authorization)

    async with aiosqlite.connect(DATABASE_URL) as db:
        # Check entry exists
        async with db.execute("SELECT id FROM entries WHERE id = ?", (entry_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Entry not found")

        # Update text if provided
        if text is not None:
            await db.execute("UPDATE entries SET text = ? WHERE id = ?", (text, entry_id))

        # Remove photos if specified
        if remove_photos:
            photo_ids = [p.strip() for p in remove_photos.split(",") if p.strip()]
            for photo_id in photo_ids:
                # Get filename to delete file
                async with db.execute("SELECT filename FROM photos WHERE id = ? AND entry_id = ?", (photo_id, entry_id)) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        filepath = Path(UPLOAD_DIR) / row[0]
                        if filepath.exists():
                            filepath.unlink()
                        await db.execute("DELETE FROM photos WHERE id = ?", (photo_id,))

        # Get current photo count
        async with db.execute("SELECT COUNT(*) FROM photos WHERE entry_id = ?", (entry_id,)) as cursor:
            current_count = (await cursor.fetchone())[0]

        # Add new photos if provided
        if photos and photos[0].filename:  # Check if actual files were uploaded
            # Get max order_index
            async with db.execute("SELECT MAX(order_index) FROM photos WHERE entry_id = ?", (entry_id,)) as cursor:
                max_idx = (await cursor.fetchone())[0] or -1

            new_count = len([p for p in photos if p.filename])
            if current_count + new_count > 5:
                raise HTTPException(status_code=400, detail=f"Maximum 5 photos per entry (currently {current_count})")

            for idx, photo in enumerate(photos):
                if not photo.filename:
                    continue
                if not photo.content_type or not photo.content_type.startswith("image/"):
                    continue

                ext = Path(photo.filename).suffix
                photo_id = str(uuid.uuid4())
                filename = f"{photo_id}{ext}"
                filepath = Path(UPLOAD_DIR) / filename

                with open(filepath, "wb") as buffer:
                    shutil.copyfileobj(photo.file, buffer)

                await db.execute(
                    "INSERT INTO photos (id, entry_id, filename, original_name, order_index) VALUES (?, ?, ?, ?, ?)",
                    (photo_id, entry_id, filename, photo.filename, max_idx + 1 + idx)
                )

        await db.commit()

    # Return updated entry
    return await get_entry(entry_id)

@app.delete("/api/entries/{entry_id}")
async def delete_entry(entry_id: str, authorization: Optional[str] = Header(None)):
    """Delete a journal entry and its photos"""
    verify_token(authorization)

    async with aiosqlite.connect(DATABASE_URL) as db:
        # Get photos to delete files
        async with db.execute(
            "SELECT filename FROM photos WHERE entry_id = ?",
            (entry_id,)
        ) as cursor:
            photos = await cursor.fetchall()

        # Delete photo files
        for photo in photos:
            filepath = Path(UPLOAD_DIR) / photo[0]
            if filepath.exists():
                filepath.unlink()

        # Delete from database
        await db.execute("DELETE FROM photos WHERE entry_id = ?", (entry_id,))
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
