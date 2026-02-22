# Design: Gallery UX Improvements

**Date:** 2026-02-22
**Features:** Swipe/keyboard lightbox navigation, sort toggle, location editing

---

## What is a Lightbox?

A **lightbox** is a UI pattern where clicking a thumbnail opens a full-screen (or near-full-screen) overlay showing the image at a larger size, dimming everything behind it. The name comes from the physical lightbox photographers used to view slides on a backlit panel.

In this app, the lightbox is implemented as a fixed-position `div` that covers the whole screen with a dark background (`rgba(0,0,0,0.95)`), with the photo centred inside it. The state variable `lightboxPhoto` holds the entry currently being viewed — when it's `null`, the overlay is hidden; when it's set to an entry object, the overlay renders with that photo.

The three improvements below build on this existing lightbox without replacing it.

---

## Feature 1: Swipe + Keyboard Navigation in Lightbox

### Scope
Navigation (swipe and arrow keys) is only enabled when the lightbox is opened from a **gallery view** (logged-in gallery or public gallery). The manage view lightbox remains a simple single-photo viewer — click to open, click to close.

### State Change
Replace the current `lightboxPhoto` state (a single entry object) with a `lightbox` state object:

```js
// null when closed, or:
{ photos: [...], index: 0 }
```

- `photos` — the ordered array of entries for the current view (`allPhotos`)
- `index` — position of the clicked photo in that array

The currently displayed photo is always `lightbox.photos[lightbox.index]`.

When opened from the **manage view**, pass `{ photos: [entry], index: 0 }` — a single-item array, so navigation has nowhere to go.

### Navigation Logic
- `lightboxNext()` — increments index, wraps around to 0 at the end
- `lightboxPrev()` — decrements index, wraps around to last at the start

### Swipe (mobile)
Attach `onTouchStart` / `onTouchEnd` to the lightbox div. Calculate horizontal delta on touch end:
- Delta > 50px right-to-left → next
- Delta > 50px left-to-right → prev
- Small movements and vertical swipes are ignored

### Keyboard (desktop)
A `useEffect` adds a `keydown` listener whenever `lightbox` is non-null:
- `ArrowRight` → next
- `ArrowLeft` → prev
- `Escape` → close

The effect cleans up the listener when the lightbox closes.

### Click Behaviour Change
- Clicking the **background** still closes the lightbox (existing behaviour)
- Clicking the **image itself** no longer closes (avoids accidental dismiss on swipe)

---

## Feature 2: Sort Toggle (Public Gallery Only)

### Scope
The toggle is only shown in the **non-logged-in (public) gallery**. Logged-in users always see the random shuffle in their gallery view.

### State
Add a `sortMode` state at the top of `App`: `'random' | 'date'`, defaulting to `'random'`.

### `allPhotos` Memo
The existing memo conditionally shuffles or date-sorts based on `sortMode`:
- `'random'` — Fisher-Yates shuffle (same as today). Re-shuffles fresh each time the user switches back to random.
- `'date'` — sort by `date DESC`, then `created_at DESC` (newest first, matching the manage view order).

### UI
A small two-button toggle ("Random" / "Date") placed above the public mosaic grid, styled consistently with the existing view toggle. Only rendered in the non-logged-in branch of the JSX.

---

## Feature 3: Location Editing in Edit Modal

### Scope
Add a location name field (with Nominatim search autocomplete) to the existing Edit modal. No inline editing — the Edit modal is the single place to change location.

### Backend Change
The `PATCH /api/entries/{id}` endpoint gains one new optional field:
```python
location_name: Optional[str] = Form(None)
```
If provided (including empty string to clear), it updates the `location_name` DB column. Existing behaviour for `text` and `photo` is unchanged.

### Frontend — Edit Modal UI
A "Location" field is added below the Story textarea. It's a standard text input pre-populated with the entry's current `location_name` (or empty if none).

**Autocomplete behaviour:**
- User types → debounced 500ms → fires Nominatim `/search` query with `, Japan` appended (since all photos are from Japan) for more relevant results
- Up to 5 results shown in a dropdown below the input
- Result name formatted using the same logic as the existing `reverseGeocode` function (amenity/road/neighbourhood/city parts joined)
- Selecting a result fills the input; dropdown closes
- Dropdown also closes on input blur
- User may ignore the dropdown and type any free-form name

**On save:**
`handleSaveEdit` appends `location_name` to the FormData. The backend updates the column.

No map is shown — text name only.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/App.jsx` | Lightbox state refactor, swipe/keyboard handlers, sort toggle state + UI, location field in Edit modal |
| `frontend/src/index.css` | Minor styles for sort toggle, location autocomplete dropdown |
| `backend/main.py` | Add `location_name` field to PATCH endpoint |
