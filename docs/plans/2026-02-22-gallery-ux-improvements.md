# Gallery UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add swipe/keyboard lightbox navigation, a sort toggle for the public gallery, and location editing with Nominatim autocomplete to the Edit modal.

**Architecture:** All three features are self-contained changes to `App.jsx` and `index.css`, plus a one-line backend addition. The lightbox state is refactored from a single entry object to `{ photos, index }` to support navigation. No new dependencies are needed.

**Tech Stack:** React 18 + Vite (frontend), FastAPI + SQLite (backend), Nominatim API (geocoding). No test framework is configured — verification is manual via the browser.

---

## Task 1: Backend — add `location_name` to PATCH endpoint

**Files:**
- Modify: `backend/main.py:241-290`

**Step 1: Add the new form field**

In `main.py`, find the `update_entry` function signature (line ~241) and add `location_name` after `text`:

```python
@app.patch("/api/entries/{entry_id}")
async def update_entry(
    entry_id: str,
    text: Optional[str] = Form(None),
    location_name: Optional[str] = Form(None),   # ← add this line
    photo: Optional[UploadFile] = File(None),
    authorization: Optional[str] = Header(None)
):
```

**Step 2: Add the DB update logic**

After the `if text is not None:` block (~line 259), add:

```python
        if location_name is not None:
            await db.execute("UPDATE entries SET location_name = ? WHERE id = ?", (location_name, entry_id))
```

**Step 3: Verify manually**

```bash
curl -X PATCH http://localhost:8000/api/entries/<any-id> \
  -H "Authorization: Bearer <your-token>" \
  -F "location_name=Shinjuku, Tokyo"
```
Expected: JSON response with `"location_name": "Shinjuku, Tokyo"`.

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: add location_name field to PATCH entries endpoint"
```

---

## Task 2: Refactor lightbox state

**Files:**
- Modify: `frontend/src/App.jsx`

This is the foundation for navigation. The current `lightboxPhoto` state (a single entry object) becomes `lightbox` — an object with the full photo array and current index.

**Step 1: Replace the state declaration**

Find line 12:
```js
const [lightboxPhoto, setLightboxPhoto] = useState(null)
```
Replace with:
```js
const [lightbox, setLightbox] = useState(null) // { photos: [], index: 0 } or null
```

**Step 2: Add helper functions** (place near the other helpers, after `getGridCols`):

```js
const openLightbox = (photos, index) => setLightbox({ photos, index })
const closeLightbox = () => setLightbox(null)
const lightboxPhoto = lightbox ? lightbox.photos[lightbox.index] : null
```

Note: `lightboxPhoto` is now a derived value (not state), so everywhere it's read it just works as before.

**Step 3: Update the manage view open call** (line ~490)

```jsx
// Before:
onClick={() => setLightboxPhoto(entry)}

// After (single-item array — no navigation in manage view):
onClick={() => openLightbox([entry], 0)}
```

**Step 4: Update the gallery view open calls** (lines ~524 and ~555)

For the logged-in gallery:
```jsx
// Before:
onClick={() => setLightboxPhoto(entry)}

// After:
onClick={() => openLightbox(allPhotos, allPhotos.findIndex(e => e.id === entry.id))}
```

Apply the same change to the public gallery block (same pattern, same fix).

**Step 5: Update the lightbox JSX** (line ~577)

```jsx
// Before:
{lightboxPhoto && (
  <div className="lightbox" onClick={() => setLightboxPhoto(null)}>

// After:
{lightbox && (
  <div className="lightbox" onClick={closeLightbox}>
```

Also update the image click so tapping the photo doesn't close the lightbox (required for swipe in next task):
```jsx
<img
  src={`${API_URL}/photos/${lightboxPhoto.filename}`}
  alt=""
  onClick={(e) => e.stopPropagation()}
/>
```

**Step 6: Verify in browser**

- Click a photo in manage view → lightbox opens, click background → closes ✓
- Click a photo in gallery view → lightbox opens, click background → closes ✓
- Click the image itself → lightbox stays open ✓

**Step 7: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "refactor: replace lightboxPhoto state with lightbox {photos, index} object"
```

---

## Task 3: Swipe navigation

**Files:**
- Modify: `frontend/src/App.jsx`

**Step 1: Add a ref to track touch start position**

Near the other `useRef` calls (or top of component):
```js
const touchStartX = useRef(null)
```

**Step 2: Add nav functions** (after the `openLightbox`/`closeLightbox` helpers from Task 2):

```js
const lightboxNext = () => setLightbox(prev =>
  prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : null
)
const lightboxPrev = () => setLightbox(prev =>
  prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : null
)
```

These use the functional updater form so they never read stale state.

**Step 3: Add touch handlers**

```js
const handleTouchStart = (e) => {
  touchStartX.current = e.touches[0].clientX
}

const handleTouchEnd = (e) => {
  if (touchStartX.current === null) return
  const delta = touchStartX.current - e.changedTouches[0].clientX
  touchStartX.current = null
  if (Math.abs(delta) < 50) return   // ignore small movements
  if (delta > 0) lightboxNext()
  else lightboxPrev()
}
```

**Step 4: Attach to the lightbox div**

```jsx
<div
  className="lightbox"
  onClick={closeLightbox}
  onTouchStart={handleTouchStart}
  onTouchEnd={handleTouchEnd}
>
```

**Step 5: Verify on mobile (or Chrome DevTools device mode)**

- Open gallery, tap a photo → lightbox opens
- Swipe left → next photo, swipe right → previous photo
- Small tap on background → closes ✓
- Tapping the image itself → stays open ✓
- At last photo, swipe left → wraps to first ✓

**Step 6: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add swipe navigation to lightbox"
```

---

## Task 4: Keyboard navigation

**Files:**
- Modify: `frontend/src/App.jsx`

**Step 1: Add the keydown effect**

Place after the `lightboxNext`/`lightboxPrev` definitions:

```js
useEffect(() => {
  if (!lightbox) return
  const handleKey = (e) => {
    if (e.key === 'ArrowRight') lightboxNext()
    else if (e.key === 'ArrowLeft') lightboxPrev()
    else if (e.key === 'Escape') closeLightbox()
  }
  window.addEventListener('keydown', handleKey)
  return () => window.removeEventListener('keydown', handleKey)
}, [lightbox])   // re-registers when lightbox opens/closes or photo changes
```

**Step 2: Verify in browser (desktop)**

- Open gallery, click a photo
- Press `→` → next photo ✓
- Press `←` → previous photo ✓
- Press `Escape` → lightbox closes ✓
- No lightbox open: arrow keys do nothing ✓

**Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add keyboard arrow/escape navigation to lightbox"
```

---

## Task 5: Sort toggle (public gallery only)

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Add state**

Near the top of the component (with other state declarations):
```js
const [sortMode, setSortMode] = useState('random') // 'random' | 'date'
```

**Step 2: Update the `allPhotos` memo**

Find the existing memo (~line 367):
```js
const allPhotos = useMemo(() => {
  return shuffleArray(entries.filter(e => e.filename))
}, [entries])
```

Replace with:
```js
const allPhotos = useMemo(() => {
  const filtered = entries.filter(e => e.filename)
  if (sortMode === 'date') {
    return [...filtered].sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date)
      return b.created_at.localeCompare(a.created_at)
    })
  }
  return shuffleArray(filtered)
}, [entries, sortMode])
```

Note: `shuffleArray` produces a fresh shuffle each time `sortMode` toggles back to `'random'` — this is intentional.

**Step 3: Add the toggle UI to the public gallery branch**

In the non-logged-in branch of the JSX, just before the `<div className="gallery-mosaic"...>`:

```jsx
<div className="sort-toggle-container">
  <div className="sort-toggle">
    <button
      className={sortMode === 'random' ? 'active' : ''}
      onClick={() => setSortMode('random')}
    >
      Random
    </button>
    <button
      className={sortMode === 'date' ? 'active' : ''}
      onClick={() => setSortMode('date')}
    >
      Date
    </button>
  </div>
</div>
```

**Step 4: Add CSS**

The `.sort-toggle-container` and `.sort-toggle` can reuse the existing `.view-toggle` styles exactly — just add aliases at the end of `index.css`:

```css
.sort-toggle-container {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.sort-toggle {
  display: flex;
  background: #e0e0e0;
  border-radius: 8px;
  padding: 4px;
}

.sort-toggle button {
  padding: 8px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-weight: 500;
  color: #666;
  transition: all 0.2s;
}

.sort-toggle button.active {
  background: white;
  color: var(--vermillion);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.sort-toggle button:hover:not(.active) {
  color: #333;
}
```

**Step 5: Verify in browser**

- Log out (or open in incognito) → sort toggle appears above the mosaic ✓
- Click "Date" → photos reorder newest-first ✓
- Click "Random" → photos reshuffle ✓
- Log in → sort toggle is not shown ✓

**Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/index.css
git commit -m "feat: add random/date sort toggle to public gallery"
```

---

## Task 6: Location editing in Edit modal

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Add edit-location state**

Near the other edit state declarations (~line 28):
```js
const [editLocationName, setEditLocationName] = useState('')
const [locationSuggestions, setLocationSuggestions] = useState([])
const [locationSearching, setLocationSearching] = useState(false)
const locationSearchTimer = useRef(null)
```

**Step 2: Initialise location when opening edit modal**

In `openEditModal` (~line 290), add two lines:
```js
const openEditModal = (entry) => {
  setEditingEntry(entry)
  setEditText(entry.text || '')
  setEditNewPhoto(null)
  setEditLocationName(entry.location_name || '')   // ← add
  setLocationSuggestions([])                        // ← add
}
```

**Step 3: Add the Nominatim search function**

Place near the existing `reverseGeocode` function:

```js
const searchLocationByName = async (query) => {
  if (!query.trim() || query.length < 3) {
    setLocationSuggestions([])
    return
  }
  setLocationSearching(true)
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Japan')}&format=json&limit=5&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    if (response.ok) {
      const results = await response.json()
      const names = results.map(r => {
        const addr = r.address || {}
        const parts = []
        if (addr.amenity || addr.building || addr.tourism) {
          parts.push(addr.amenity || addr.building || addr.tourism)
        }
        if (addr.road) parts.push(addr.road)
        if (addr.neighbourhood || addr.suburb || addr.quarter) {
          parts.push(addr.neighbourhood || addr.suburb || addr.quarter)
        }
        if (addr.city || addr.town || addr.village) {
          parts.push(addr.city || addr.town || addr.village)
        }
        return parts.slice(0, 3).join(', ') || r.display_name?.split(',').slice(0, 3).join(',').trim()
      }).filter(Boolean)
      setLocationSuggestions(names)
    }
  } catch {
    // ignore search errors
  } finally {
    setLocationSearching(false)
  }
}
```

**Step 4: Add the debounced input handler**

```js
const handleLocationInput = (value) => {
  setEditLocationName(value)
  setLocationSuggestions([])
  clearTimeout(locationSearchTimer.current)
  locationSearchTimer.current = setTimeout(() => searchLocationByName(value), 500)
}
```

**Step 5: Send location_name on save**

In `handleSaveEdit` (~line 301), add to the FormData before the fetch:
```js
formData.append('location_name', editLocationName)
```

**Step 6: Add location field to the Edit modal JSX**

Inside `.edit-form`, add a new section after the Story textarea block and before `.edit-actions`:

```jsx
<div className="edit-text">
  <label>Location</label>
  <div className="location-input-wrapper">
    <input
      type="text"
      value={editLocationName}
      onChange={(e) => handleLocationInput(e.target.value)}
      onBlur={() => setTimeout(() => setLocationSuggestions([]), 150)}
      placeholder="Search for a place..."
    />
    {locationSearching && <span className="location-searching">searching...</span>}
    {locationSuggestions.length > 0 && (
      <ul className="location-suggestions">
        {locationSuggestions.map((s, i) => (
          <li
            key={i}
            onMouseDown={() => {
              setEditLocationName(s)
              setLocationSuggestions([])
            }}
          >
            {s}
          </li>
        ))}
      </ul>
    )}
  </div>
</div>
```

Note: `onMouseDown` fires before `onBlur`, so clicking a suggestion fills the field before the dropdown hides.
The `setTimeout` on `onBlur` gives the `onMouseDown` time to fire first.

**Step 7: Add CSS**

```css
.location-input-wrapper {
  position: relative;
}

.location-input-wrapper input {
  width: 100%;
  box-sizing: border-box;
}

.location-searching {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  color: #888;
}

.location-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #1a1a2e;
  border: 1px solid #444;
  border-radius: 8px;
  list-style: none;
  padding: 4px 0;
  margin: 4px 0 0;
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.location-suggestions li {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.85rem;
  color: #ddd;
}

.location-suggestions li:hover {
  background: rgba(255, 182, 193, 0.15);
  color: #ffb6c1;
}
```

**Step 8: Verify in browser**

- Click Edit on an entry with a location → location field is pre-filled ✓
- Click Edit on an entry without a location → field is empty ✓
- Type 3+ chars → dropdown appears with suggestions after ~500ms ✓
- Select a suggestion → field fills, dropdown closes ✓
- Type a custom name and save → location updates on the entry card ✓
- Clear the field and save → location badge disappears from entry card ✓

**Step 9: Commit**

```bash
git add frontend/src/App.jsx frontend/src/index.css backend/main.py
git commit -m "feat: add location editing with Nominatim autocomplete to Edit modal"
```
