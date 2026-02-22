import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import exifr from 'exifr'
import imageCompression from 'browser-image-compression'

const API_URL = '/api'

function App() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [lightbox, setLightbox] = useState(null) // { photos: [], index: 0 } or null
  const [view, setView] = useState('manage') // 'manage' or 'gallery' (for logged in)

  // Auth state
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') || '')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [loginPassword, setLoginPassword] = useState('')

  // Form state - flat list of selected photos
  const [selectedPhotos, setSelectedPhotos] = useState([]) // [{file, date, location, locationName}]
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [compressing, setCompressing] = useState(false)

  const touchStartX = useRef(null)

  // Edit state
  const [editingEntry, setEditingEntry] = useState(null)
  const [editText, setEditText] = useState('')
  const [editNewPhoto, setEditNewPhoto] = useState(null)
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

    const today = new Date().toISOString().split('T')[0]
    const photos = []

    for (const file of files) {
      let dateStr = today
      let locationName = null
      let location = null

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
          location = { latitude: gps.latitude, longitude: gps.longitude }
        }
      } catch {
        // No EXIF data
      }

      photos.push({ file, date: dateStr, location, locationName })
    }

    setSelectedPhotos(photos)

    // Reverse geocode each photo with GPS
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i]
      if (p.location) {
        const name = await reverseGeocode(p.location.latitude, p.location.longitude)
        if (name) {
          setSelectedPhotos(prev => prev.map((item, idx) =>
            idx === i ? { ...item, locationName: name } : item
          ))
        }
        // Rate limit: 1s between Nominatim requests
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  const handleRemovePhoto = (index) => {
    setSelectedPhotos(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (selectedPhotos.length === 0) {
      setError('Please select photos')
      return
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

      // Group photos by date for the API call
      const byDate = {}
      for (const photo of selectedPhotos) {
        if (!byDate[photo.date]) byDate[photo.date] = []
        byDate[photo.date].push(photo)
      }

      let successCount = 0
      for (const [date, photos] of Object.entries(byDate)) {
        const compressedPhotos = await Promise.all(
          photos.map(async (p) => {
            try {
              const compressed = await imageCompression(p.file, compressionOptions)
              return { ...p, compressedFile: new File([compressed], p.file.name, { type: compressed.type }) }
            } catch {
              return { ...p, compressedFile: p.file }
            }
          })
        )

        setCompressing(false)

        const formData = new FormData()
        formData.append('date', date)
        formData.append('text', text)

        // Build per-photo location names map
        const locationsMap = {}
        for (const p of compressedPhotos) {
          if (p.locationName) {
            locationsMap[p.file.name] = p.locationName
          }
        }
        if (Object.keys(locationsMap).length > 0) {
          formData.append('photo_locations', JSON.stringify(locationsMap))
        }

        compressedPhotos.forEach((p) => {
          formData.append('photos', p.compressedFile, p.file.name)
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

        const created = await response.json()
        successCount += created.length
      }

      setSuccess(`Created ${successCount} ${successCount === 1 ? 'entry' : 'entries'}!`)
      setText('')
      setSelectedPhotos([])
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
    setEditNewPhoto(null)
  }

  const handleEditPhotoChange = async (e) => {
    const file = e.target.files[0]
    if (file) setEditNewPhoto(file)
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('text', editText)

      // Compress and add replacement photo
      if (editNewPhoto) {
        const compressionOptions = {
          maxSizeMB: 1,
          maxWidthOrHeight: 2048,
          useWebWorker: true,
          preserveExif: true,
        }
        try {
          const compressed = await imageCompression(editNewPhoto, compressionOptions)
          formData.append('photo', new File([compressed], editNewPhoto.name, { type: compressed.type }))
        } catch {
          formData.append('photo', editNewPhoto)
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

  // Shuffle array using Fisher-Yates algorithm
  const shuffleArray = (array) => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  // In the new model, each entry IS a photo — no flattening needed
  const allPhotos = useMemo(() => {
    return shuffleArray(entries.filter(e => e.filename))
  }, [entries])

  // Calculate grid columns based on photo count
  const getGridCols = (count) => {
    if (count === 0) return 1
    return Math.ceil(Math.sqrt(count))
  }

  const openLightbox = (photos, index) => setLightbox({ photos, index })
  const closeLightbox = useCallback(() => {
    touchStartX.current = null
    setLightbox(null)
  }, [])
  const lightboxPhoto = lightbox ? lightbox.photos[lightbox.index] : null

  const lightboxNext = useCallback(() => setLightbox(prev =>
    prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : null
  ), [])
  const lightboxPrev = useCallback(() => setLightbox(prev =>
    prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : null
  ), [])

  useEffect(() => {
    if (!lightbox) return
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') lightboxNext()
      else if (e.key === 'ArrowLeft') lightboxPrev()
      else if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightbox, lightboxNext, lightboxPrev, closeLightbox])

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

  // Memoize object URLs to avoid recreating on every render (fixes slow typing)
  const previewUrls = useMemo(() => {
    return selectedPhotos.map(p => URL.createObjectURL(p.file))
  }, [selectedPhotos])

  const editPreviewUrl = useMemo(() => {
    return editNewPhoto ? URL.createObjectURL(editNewPhoto) : null
  }, [editNewPhoto])

  return (
    <div className="app">
      <header className="header">
        <h1>Gaia Travels 2026</h1>
        <p>G explores Japan</p>
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
                    <label>Photos (up to 10, each becomes its own entry)</label>
                    <div className="photo-upload" onClick={() => document.getElementById('photo-input').click()}>
                      <input
                        type="file"
                        id="photo-input"
                        accept="image/*,.heic,.heif"
                        multiple
                        onChange={handlePhotoChange}
                      />
                      <p>Click to select photos</p>
                      <small>Each photo becomes its own entry</small>
                    </div>

                    {selectedPhotos.length > 0 && (
                      <div className="photo-previews" style={{ marginTop: '12px' }}>
                        {selectedPhotos.map((photo, index) => (
                          <div key={index} className="photo-preview">
                            <img src={previewUrls[index]} alt="" />
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleRemovePhoto(index) }}>×</button>
                            <div className="photo-preview-info">
                              <span className="date-badge">{formatDate(photo.date)}</span>
                              {photo.locationName && <span className="location-badge" title={photo.locationName}>📍</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="text">Story (optional, shared across all entries)</label>
                    <textarea
                      id="text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="What happened?"
                      rows={3}
                    />
                  </div>

                  <button type="submit" className="submit-button" disabled={submitting || selectedPhotos.length === 0}>
                    {compressing ? 'Compressing...' : submitting ? 'Uploading...' : `Post ${selectedPhotos.length || ''} ${selectedPhotos.length === 1 ? 'Entry' : 'Entries'}`}
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
                        {entry.filename && (
                          <div className="entry-photos single">
                            <img
                              src={`${API_URL}/photos/${entry.filename}`}
                              alt=""
                              onClick={() => openLightbox([entry], 0)}
                            />
                          </div>
                        )}
                        <div className="entry-content">
                          <div className="entry-date">{formatDateLong(entry.date)}</div>
                          {entry.location_name && (
                            <span className="entry-location">
                              📍 {entry.location_name}
                            </span>
                          )}
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
              {allPhotos.map((entry) => (
                <div key={entry.id} className="gallery-mosaic-item">
                  <img
                    src={`${API_URL}/photos/${entry.filename}`}
                    alt=""
                    onClick={() => openLightbox(allPhotos, allPhotos.findIndex(e => e.id === entry.id))}
                  />
                  <div className="gallery-item-overlay">
                    <div className="gallery-item-date">{formatDate(entry.date)}</div>
                    {entry.location_name && (
                      <div className="gallery-item-location">📍 {entry.location_name}</div>
                    )}
                    {entry.text && <div className="gallery-item-text">{entry.text}</div>}
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
              {allPhotos.map((entry) => (
                <div key={entry.id} className="gallery-mosaic-item">
                  <img
                    src={`${API_URL}/photos/${entry.filename}`}
                    alt=""
                    onClick={() => openLightbox(allPhotos, allPhotos.findIndex(e => e.id === entry.id))}
                  />
                  <div className="gallery-item-overlay">
                    <div className="gallery-item-date">{formatDate(entry.date)}</div>
                    {entry.location_name && (
                      <div className="gallery-item-location">📍 {entry.location_name}</div>
                    )}
                    {entry.text && <div className="gallery-item-text">{entry.text}</div>}
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
      {lightbox && (
        <div
          className="lightbox"
          onClick={closeLightbox}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <img
            src={`${API_URL}/photos/${lightboxPhoto.filename}`}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />
          <div className="lightbox-info">
            <div className="lightbox-date">{formatDateLong(lightboxPhoto.date)}</div>
            {lightboxPhoto.location_name && (
              <div className="lightbox-location">📍 {lightboxPhoto.location_name}</div>
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
              <label>Current photo</label>
              {editingEntry.filename && (
                <div className="edit-photo-grid">
                  <div className="edit-photo-item">
                    <img src={`${API_URL}/photos/${editingEntry.filename}`} alt="" />
                  </div>
                </div>
              )}

              <div className="add-photos-section" style={{ marginTop: '12px' }}>
                <label>Replace photo</label>
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleEditPhotoChange}
                />
                {editNewPhoto && editPreviewUrl && (
                  <div className="new-photos-preview">
                    <img src={editPreviewUrl} alt="" />
                  </div>
                )}
              </div>
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
