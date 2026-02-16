import { useState, useEffect, useMemo, useRef } from 'react'
import exifr from 'exifr'
import imageCompression from 'browser-image-compression'

const API_URL = '/api'

function App() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)
  const [view, setView] = useState('manage') // 'manage' or 'gallery' (for logged in)

  // Auth state
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') || '')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [loginPassword, setLoginPassword] = useState('')

  // Form state - photos grouped by date
  const [photosByDate, setPhotosByDate] = useState({})
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [locationByDate, setLocationByDate] = useState({})

  // Edit state
  const [editingEntry, setEditingEntry] = useState(null)
  const [editText, setEditText] = useState('')
  const [editNewPhotos, setEditNewPhotos] = useState([])
  const [photosToRemove, setPhotosToRemove] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchEntries()
    if (authToken) {
      verifyToken(authToken)
    }
  }, [])

  const verifyToken = async (token) => {
    try {
      const response = await fetch(`${API_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        setIsLoggedIn(true)
      } else {
        localStorage.removeItem('authToken')
        setAuthToken('')
        setIsLoggedIn(false)
      }
    } catch {
      setIsLoggedIn(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${loginPassword}` }
      })
      if (response.ok) {
        localStorage.setItem('authToken', loginPassword)
        setAuthToken(loginPassword)
        setIsLoggedIn(true)
        setShowLogin(false)
        setLoginPassword('')
        setError(null)
      } else {
        setError('Invalid password')
      }
    } catch {
      setError('Login failed')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    setAuthToken('')
    setIsLoggedIn(false)
  }

  const fetchEntries = async () => {
    try {
      const response = await fetch(`${API_URL}/entries`)
      if (!response.ok) throw new Error('Failed to fetch entries')
      const data = await response.json()
      setEntries(data)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  // Per-photo location names resolved from EXIF GPS
  const [photoLocationNames, setPhotoLocationNames] = useState({})

  const reverseGeocode = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17`,
        { headers: { 'Accept-Language': 'en' } }
      )
      if (response.ok) {
        const data = await response.json()
        const addr = data.address || {}
        const parts = []
        // Most specific first
        if (addr.amenity || addr.building || addr.aeroway || addr.tourism) {
          parts.push(addr.amenity || addr.building || addr.aeroway || addr.tourism)
        }
        if (addr.road) parts.push(addr.road)
        if (addr.neighbourhood || addr.suburb || addr.quarter) {
          parts.push(addr.neighbourhood || addr.suburb || addr.quarter)
        }
        if (addr.city || addr.town || addr.village) {
          parts.push(addr.city || addr.town || addr.village)
        }
        // Take up to 3 most specific parts for a good balance
        const name = parts.slice(0, 3).join(', ')
        return name || data.display_name?.split(',').slice(0, 3).join(',').trim() || null
      }
    } catch {
      // Ignore geocoding errors
    }
    return null
  }

  const handlePhotoChange = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length > 10) {
      setError('Maximum 10 photos at a time')
      return
    }
    setError(null)

    const grouped = {}
    const locations = {}
    const photoLocations = {}
    const today = new Date().toISOString().split('T')[0]

    for (const file of files) {
      let dateStr = today
      try {
        const [gps, exif] = await Promise.all([
          exifr.gps(file).catch(() => null),
          exifr.parse(file, ['DateTimeOriginal']).catch(() => null)
        ])
        if (exif?.DateTimeOriginal) {
          const photoDate = new Date(exif.DateTimeOriginal)
          dateStr = photoDate.toISOString().split('T')[0]
        }
        if (gps?.latitude && gps?.longitude) {
          if (!locations[dateStr]) {
            locations[dateStr] = { latitude: gps.latitude, longitude: gps.longitude }
          }
          photoLocations[file.name] = { latitude: gps.latitude, longitude: gps.longitude }
        }
      } catch {
        // No EXIF data
      }

      if (!grouped[dateStr]) grouped[dateStr] = []
      grouped[dateStr].push(file)
    }

    setPhotosByDate(grouped)
    setLocationByDate(locations)

    // Reverse geocode each photo's location
    const names = {}
    for (const [filename, coords] of Object.entries(photoLocations)) {
      const name = await reverseGeocode(coords.latitude, coords.longitude)
      if (name) names[filename] = name
      // Rate limit: 1s between Nominatim requests
      await new Promise(r => setTimeout(r, 1000))
    }
    setPhotoLocationNames(names)
  }

  const handleRemovePhoto = (date, index) => {
    setPhotosByDate(prev => {
      const updated = { ...prev }
      updated[date] = updated[date].filter((_, i) => i !== index)
      if (updated[date].length === 0) delete updated[date]
      return updated
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const dates = Object.keys(photosByDate)
    if (dates.length === 0) {
      setError('Please select photos')
      return
    }

    for (const date of dates) {
      if (photosByDate[date].length > 5) {
        setError(`Maximum 5 photos per day (${date} has ${photosByDate[date].length})`)
        return
      }
    }

    setSubmitting(true)
    setCompressing(true)

    try {
      const compressionOptions = {
        maxSizeMB: 1,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
        preserveExif: true,
      }

      let successCount = 0
      for (const date of dates) {
        const photos = photosByDate[date]

        const compressedPhotos = await Promise.all(
          photos.map(async (photo) => {
            try {
              const compressed = await imageCompression(photo, compressionOptions)
              return new File([compressed], photo.name, { type: compressed.type })
            } catch {
              return photo
            }
          })
        )

        setCompressing(false)

        const formData = new FormData()
        formData.append('date', date)
        formData.append('text', text)
        if (locationByDate[date]) {
          formData.append('latitude', locationByDate[date].latitude)
          formData.append('longitude', locationByDate[date].longitude)
        }
        // Send per-photo location names
        const locationsForEntry = {}
        for (const photo of photos) {
          if (photoLocationNames[photo.name]) {
            locationsForEntry[photo.name] = photoLocationNames[photo.name]
          }
        }
        if (Object.keys(locationsForEntry).length > 0) {
          formData.append('photo_locations', JSON.stringify(locationsForEntry))
        }
        compressedPhotos.forEach((photo) => {
          formData.append('photos', photo, photo.name)
        })

        const response = await fetch(`${API_URL}/entries`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` },
          body: formData,
        })

        if (!response.ok) {
          if (response.status === 413) throw new Error('Photos too large')
          throw new Error('Failed to create entry')
        }
        successCount++
      }

      setSuccess(`Created ${successCount} ${successCount === 1 ? 'entry' : 'entries'}!`)
      setText('')
      setPhotosByDate({})
      setLocationByDate({})
      setPhotoLocationNames({})
      fetchEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
      setCompressing(false)
    }
  }

  const handleDeleteEntry = async (entryId) => {
    if (!confirm('Delete this entry?')) return

    try {
      const response = await fetch(`${API_URL}/entries/${entryId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` },
      })
      if (!response.ok) throw new Error('Failed to delete')
      setSuccess('Entry deleted!')
      fetchEntries()
    } catch (err) {
      setError(err.message)
    }
  }

  const openEditModal = (entry) => {
    setEditingEntry(entry)
    setEditText(entry.text || '')
    setEditNewPhotos([])
    setPhotosToRemove([])
  }

  const handleEditPhotoChange = async (e) => {
    const files = Array.from(e.target.files)
    const currentPhotos = editingEntry.photos.length - photosToRemove.length
    const maxNew = 5 - currentPhotos

    if (files.length > maxNew) {
      setError(`Can only add ${maxNew} more photo(s)`)
      return
    }

    setEditNewPhotos(files)
  }

  const togglePhotoRemoval = (photoId) => {
    setPhotosToRemove(prev =>
      prev.includes(photoId)
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId]
    )
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('text', editText)

      if (photosToRemove.length > 0) {
        formData.append('remove_photos', photosToRemove.join(','))
      }

      // Compress and add new photos
      if (editNewPhotos.length > 0) {
        const compressionOptions = {
          maxSizeMB: 1,
          maxWidthOrHeight: 2048,
          useWebWorker: true,
          preserveExif: true,
        }

        for (const photo of editNewPhotos) {
          try {
            const compressed = await imageCompression(photo, compressionOptions)
            formData.append('photos', new File([compressed], photo.name, { type: compressed.type }))
          } catch {
            formData.append('photos', photo)
          }
        }
      }

      const response = await fetch(`${API_URL}/entries/${editingEntry.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Failed to update')
      }

      setSuccess('Entry updated!')
      setEditingEntry(null)
      fetchEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateString) => {
    const options = { weekday: 'short', month: 'short', day: 'numeric' }
    return new Date(dateString).toLocaleDateString('en-US', options)
  }

  const formatDateLong = (dateString) => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    return new Date(dateString).toLocaleDateString('en-US', options)
  }

  // Cache for reverse geocoded location names
  const [locationNames, setLocationNames] = useState({})

  // Reverse geocode entry-level locations (fallback for entries without per-photo locations)
  useEffect(() => {
    const geocodeLocations = async () => {
      for (const entry of entries) {
        if (entry.latitude && entry.longitude) {
          const key = `${entry.latitude},${entry.longitude}`
          if (!locationNames[key]) {
            const name = await reverseGeocode(entry.latitude, entry.longitude)
            if (name) {
              setLocationNames(prev => ({ ...prev, [key]: name }))
            }
            // Rate limit: wait 1s between requests (Nominatim policy)
            await new Promise(r => setTimeout(r, 1000))
          }
        }
      }
    }
    if (entries.length > 0) geocodeLocations()
  }, [entries])

  const getLocationName = (lat, lng) => {
    if (!lat || !lng) return null
    return locationNames[`${lat},${lng}`] || null
  }

  // Shuffle array using Fisher-Yates algorithm with seeded random for consistency per session
  const shuffleArray = (array) => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  const allPhotos = useMemo(() => {
    const photos = entries.flatMap(entry =>
      entry.photos.map(photo => ({
        ...photo,
        date: entry.date,
        entryId: entry.id,
        text: entry.text,
        latitude: entry.latitude,
        longitude: entry.longitude
      }))
    )
    return shuffleArray(photos)
  }, [entries])

  // Get display location for a photo: prefer photo-level, fall back to entry-level geocoded
  const getPhotoLocation = (photo) => {
    if (photo.location_name) return photo.location_name
    return getLocationName(photo.latitude, photo.longitude)
  }

  // Calculate grid columns based on photo count
  const getGridCols = (count) => {
    if (count === 0) return 1
    return Math.ceil(Math.sqrt(count))
  }

  // Memoize object URLs to avoid recreating on every render (fixes slow typing)
  const previewUrls = useMemo(() => {
    const urls = {}
    for (const [date, photos] of Object.entries(photosByDate)) {
      urls[date] = photos.map(f => URL.createObjectURL(f))
    }
    return urls
  }, [photosByDate])

  const editPreviewUrls = useMemo(() => {
    return editNewPhotos.map(f => URL.createObjectURL(f))
  }, [editNewPhotos])

  const sortedDates = Object.keys(photosByDate).sort()

  return (
    <div className="app">
      <header className="header">
        <h1>Japan Journal</h1>
        <p>Daily memories from my journey</p>
        {!isLoggedIn && (
          <button className="login-link" onClick={() => setShowLogin(true)}>
            •••
          </button>
        )}
        {isLoggedIn && (
          <button className="logout-link" onClick={handleLogout}>
            Logout
          </button>
        )}
      </header>

      {error && <div className="error-message" style={{maxWidth: '1200px', margin: '0 auto 20px'}}>{error}</div>}
      {success && <div className="success-message" style={{maxWidth: '1200px', margin: '0 auto 20px'}}>{success}</div>}

      {isLoggedIn ? (
        <>
          {/* VIEW TOGGLE */}
          <div className="view-toggle-container">
            <div className="view-toggle">
              <button className={view === 'manage' ? 'active' : ''} onClick={() => setView('manage')}>
                Manage
              </button>
              <button className={view === 'gallery' ? 'active' : ''} onClick={() => setView('gallery')}>
                Gallery
              </button>
            </div>
          </div>

          {view === 'manage' ? (
            <>
              {/* POST FORM */}
              <div className="add-entry-form">
                <h2 style={{ marginBottom: '20px' }}>Add Entry</h2>

                <form onSubmit={handleSubmit} noValidate>
                  <div className="form-group">
                    <label>Photos (up to 10, max 5 per day)</label>
                    <div className="photo-upload" onClick={() => document.getElementById('photo-input').click()}>
                      <input
                        type="file"
                        id="photo-input"
                        accept="image/*,.heic,.heif"
                        multiple
                        onChange={handlePhotoChange}
                      />
                      <p>Click to select photos</p>
                      <small>Grouped by date automatically</small>
                    </div>

                    {sortedDates.length > 0 && (
                      <div className="photos-by-date">
                        {sortedDates.map(date => (
                          <div key={date} className="date-group">
                            <div className="date-group-header">
                              <span className="date-badge">{formatDateLong(date)}</span>
                              <span className="photo-count">{photosByDate[date].length} photo{photosByDate[date].length !== 1 ? 's' : ''}</span>
                              {locationByDate[date] && <span className="location-badge">📍</span>}
                            </div>
                            <div className="photo-previews">
                              {photosByDate[date].map((photo, index) => (
                                <div key={index} className="photo-preview">
                                  <img src={previewUrls[date]?.[index]} alt="" />
                                  <button type="button" onClick={(e) => { e.stopPropagation(); handleRemovePhoto(date, index) }}>×</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="text">Story (optional)</label>
                    <textarea
                      id="text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="What happened?"
                      rows={3}
                    />
                  </div>

                  <button type="submit" className="submit-button" disabled={submitting || sortedDates.length === 0}>
                    {compressing ? 'Compressing...' : submitting ? 'Uploading...' : `Post ${sortedDates.length || ''} ${sortedDates.length === 1 ? 'Entry' : 'Entries'}`}
                  </button>
                </form>
              </div>

              {/* ENTRIES LIST */}
              <div className="entries-section">
                <h2 style={{ marginBottom: '20px' }}>Entries</h2>
                {loading ? (
                  <div className="loading">Loading...</div>
                ) : entries.length === 0 ? (
                  <div className="loading">No entries yet</div>
                ) : (
                  <div className="entries-grid">
                    {entries.map((entry) => (
                      <div key={entry.id} className="entry-card">
                        <div className={`entry-photos ${entry.photos.length === 1 ? 'single' : ''}`}>
                          {entry.photos.map((photo) => (
                            <img
                              key={photo.id}
                              src={`${API_URL}/photos/${photo.filename}`}
                              alt=""
                              onClick={() => setLightboxPhoto(photo)}
                            />
                          ))}
                        </div>
                        <div className="entry-content">
                          <div className="entry-date">{formatDateLong(entry.date)}</div>
                          {(() => {
                            const photoLocs = entry.photos
                              .map(p => p.location_name)
                              .filter(Boolean)
                            const uniqueLocs = [...new Set(photoLocs)]
                            const entryLoc = entry.latitude && entry.longitude
                              ? getLocationName(entry.latitude, entry.longitude)
                              : null
                            const locations = uniqueLocs.length > 0 ? uniqueLocs : (entryLoc ? [entryLoc] : [])
                            return locations.map((loc, i) => (
                              <span key={i} className="entry-location">
                                📍 {loc}
                              </span>
                            ))
                          })()}
                          {entry.text && <p className="entry-text">{entry.text}</p>}
                          <div className="entry-actions">
                            <button className="edit-entry-button" onClick={() => openEditModal(entry)}>Edit</button>
                            <button className="delete-entry-button" onClick={() => handleDeleteEntry(entry.id)}>Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* GALLERY VIEW FOR LOGGED IN */
            <div
              className="gallery-mosaic"
              style={{ gridTemplateColumns: `repeat(${getGridCols(allPhotos.length)}, 1fr)` }}
            >
              {allPhotos.map((photo) => (
                <div key={photo.id} className="gallery-mosaic-item">
                  <img
                    src={`${API_URL}/photos/${photo.filename}`}
                    alt=""
                    onClick={() => setLightboxPhoto(photo)}
                  />
                  <div className="gallery-item-overlay">
                    <div className="gallery-item-date">{formatDate(photo.date)}</div>
                    {getPhotoLocation(photo) && (
                      <div className="gallery-item-location">📍 {getPhotoLocation(photo)}</div>
                    )}
                    {photo.text && <div className="gallery-item-text">{photo.text}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* PUBLIC GALLERY */
        <div
          className="gallery-mosaic"
          style={{ gridTemplateColumns: `repeat(${getGridCols(allPhotos.length + 1)}, 1fr)` }}
        >
          {loading ? (
            <div className="loading" style={{gridColumn: '1 / -1', textAlign: 'center'}}>Loading...</div>
          ) : allPhotos.length === 0 ? (
            <div className="loading" style={{gridColumn: '1 / -1', textAlign: 'center'}}>No photos yet</div>
          ) : (
            <>
              {allPhotos.map((photo) => (
                <div key={photo.id} className="gallery-mosaic-item">
                  <img
                    src={`${API_URL}/photos/${photo.filename}`}
                    alt=""
                    onClick={() => setLightboxPhoto(photo)}
                  />
                  <div className="gallery-item-overlay">
                    <div className="gallery-item-date">{formatDate(photo.date)}</div>
                    {getPhotoLocation(photo) && (
                      <div className="gallery-item-location">📍 {getPhotoLocation(photo)}</div>
                    )}
                    {photo.text && <div className="gallery-item-text">{photo.text}</div>}
                  </div>
                </div>
              ))}
              <div className="gallery-placeholder">
                <span>つづく</span>
                <small>to be continued...</small>
              </div>
            </>
          )}
        </div>
      )}

      {/* LIGHTBOX */}
      {lightboxPhoto && (
        <div className="lightbox" onClick={() => setLightboxPhoto(null)}>
          <img src={`${API_URL}/photos/${lightboxPhoto.filename}`} alt="" />
          <div className="lightbox-info">
            <div className="lightbox-date">{formatDateLong(lightboxPhoto.date)}</div>
            {getPhotoLocation(lightboxPhoto) && (
              <div className="lightbox-location">📍 {getPhotoLocation(lightboxPhoto)}</div>
            )}
            {lightboxPhoto.text && <div className="lightbox-text">{lightboxPhoto.text}</div>}
          </div>
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLogin && (
        <div className="login-modal" onClick={() => setShowLogin(false)}>
          <div className="login-form" onClick={(e) => e.stopPropagation()}>
            <h3>Login</h3>
            <form onSubmit={handleLogin}>
              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoFocus
              />
              <button type="submit">Login</button>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editingEntry && (
        <div className="edit-modal" onClick={() => setEditingEntry(null)}>
          <div className="edit-form" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Entry - {formatDate(editingEntry.date)}</h3>

            <div className="edit-photos">
              <label>Photos (click to remove)</label>
              <div className="edit-photo-grid">
                {editingEntry.photos.map((photo) => (
                  <div
                    key={photo.id}
                    className={`edit-photo-item ${photosToRemove.includes(photo.id) ? 'removing' : ''}`}
                    onClick={() => togglePhotoRemoval(photo.id)}
                  >
                    <img src={`${API_URL}/photos/${photo.filename}`} alt="" />
                    {photosToRemove.includes(photo.id) && <div className="remove-overlay">Remove</div>}
                  </div>
                ))}
              </div>

              {editingEntry.photos.length - photosToRemove.length < 5 && (
                <div className="add-photos-section">
                  <label>Add more photos</label>
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    multiple
                    onChange={handleEditPhotoChange}
                  />
                  {editNewPhotos.length > 0 && (
                    <div className="new-photos-preview">
                      {editNewPhotos.map((file, idx) => (
                        <img key={idx} src={editPreviewUrls[idx]} alt="" />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="edit-text">
              <label>Story</label>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={4}
              />
            </div>

            <div className="edit-actions">
              <button className="cancel-button" onClick={() => setEditingEntry(null)}>Cancel</button>
              <button className="save-button" onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
