from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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

app = FastAPI(title="Japan Journal API")

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
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                entry_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                original_name TEXT,
                order_index INTEGER NOT NULL,
                FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_photos_entry ON photos(entry_id)")
        await db.commit()

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.post("/api/entries")
async def create_entry(
    date: str = Form(...),
    text: Optional[str] = Form(None),
    photos: List[UploadFile] = File(...)
):
    """Create a new journal entry with 1-5 photos"""
    if len(photos) < 1 or len(photos) > 5:
        raise HTTPException(status_code=400, detail="Must upload 1-5 photos")

    # Validate date format
    try:
        entry_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    # Check if entry already exists for this date
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute("SELECT id FROM entries WHERE date = ?", (date,)) as cursor:
            existing = await cursor.fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="Entry already exists for this date")

    # Create entry
    entry_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()

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
            "order_index": idx
        })

    # Save to database
    async with aiosqlite.connect(DATABASE_URL) as db:
        await db.execute(
            "INSERT INTO entries (id, date, text, created_at) VALUES (?, ?, ?, ?)",
            (entry_id, date, text, created_at)
        )

        for photo in saved_photos:
            await db.execute(
                "INSERT INTO photos (id, entry_id, filename, original_name, order_index) VALUES (?, ?, ?, ?, ?)",
                (photo["id"], entry_id, photo["filename"], photo["original_name"], photo["order_index"])
            )

        await db.commit()

    return {
        "id": entry_id,
        "date": date,
        "text": text,
        "created_at": created_at,
        "photos": saved_photos
    }

@app.get("/api/entries")
async def get_entries():
    """Get all journal entries"""
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute(
            "SELECT id, date, text, created_at FROM entries ORDER BY date DESC"
        ) as cursor:
            entries = []
            async for row in cursor:
                entry = {
                    "id": row[0],
                    "date": row[1],
                    "text": row[2],
                    "created_at": row[3],
                    "photos": []
                }

                # Get photos for this entry
                async with db.execute(
                    "SELECT id, filename, original_name, order_index FROM photos WHERE entry_id = ? ORDER BY order_index",
                    (row[0],)
                ) as photo_cursor:
                    async for photo_row in photo_cursor:
                        entry["photos"].append({
                            "id": photo_row[0],
                            "filename": photo_row[1],
                            "original_name": photo_row[2],
                            "order_index": photo_row[3]
                        })

                entries.append(entry)

    return entries

@app.get("/api/entries/{entry_id}")
async def get_entry(entry_id: str):
    """Get a single journal entry"""
    async with aiosqlite.connect(DATABASE_URL) as db:
        async with db.execute(
            "SELECT id, date, text, created_at FROM entries WHERE id = ?",
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

@app.delete("/api/entries/{entry_id}")
async def delete_entry(entry_id: str):
    """Delete a journal entry and its photos"""
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
