import { useState, useEffect } from 'react'

const API_URL = '/api'

function App() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [lightboxImage, setLightboxImage] = useState(null)

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchEntries()
  }, [])

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

  const handlePhotoChange = (e) => {
    const files = Array.from(e.target.files)
    if (files.length > 5) {
      setError('Maximum 5 photos allowed')
      return
    }
    setPhotos(files)
    setError(null)
  }

  const handleRemovePhoto = (index) => {
    setPhotos(photos.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (photos.length < 1 || photos.length > 5) {
      setError('Please select 1-5 photos')
      return
    }

    setSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('date', date)
      formData.append('text', text)
      photos.forEach((photo) => {
        formData.append('photos', photo)
      })

      const response = await fetch(`${API_URL}/entries`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to create entry')
      }

      setSuccess('Entry created successfully!')
      setText('')
      setPhotos([])
      setDate(new Date().toISOString().split('T')[0])
      fetchEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteEntry = async (entryId) => {
    if (!confirm('Are you sure you want to delete this entry?')) return

    try {
      const response = await fetch(`${API_URL}/entries/${entryId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete entry')

      setSuccess('Entry deleted successfully!')
      fetchEntries()
    } catch (err) {
      setError(err.message)
    }
  }

  const formatDate = (dateString) => {
    const options = { year: 'numeric', month: 'long', day: 'numeric' }
    return new Date(dateString).toLocaleDateString('en-US', options)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🇯🇵 Japan Journal</h1>
        <p>Daily memories from my journey</p>
      </header>

      <div className="add-entry-form">
        <h2 style={{ marginBottom: '20px' }}>Add Today's Entry</h2>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input
              type="date"
              id="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="text">Your Story</label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What happened today? Where did you go? What did you see?"
            />
          </div>

          <div className="form-group">
            <label>Photos (1-5 required)</label>
            <div
              className="photo-upload"
              onClick={() => document.getElementById('photo-input').click()}
            >
              <input
                type="file"
                id="photo-input"
                accept="image/*"
                multiple
                onChange={handlePhotoChange}
              />
              <p>📸 Click to select photos</p>
              <small>Select 1-5 photos from your day</small>
            </div>

            {photos.length > 0 && (
              <div className="photo-previews">
                {photos.map((photo, index) => (
                  <div key={index} className="photo-preview">
                    <img src={URL.createObjectURL(photo)} alt={`Preview ${index + 1}`} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemovePhoto(index)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="submit" className="submit-button" disabled={submitting}>
            {submitting ? 'Posting...' : 'Post Entry'}
          </button>
        </form>
      </div>

      <div className="entries-section">
        <h2>My Journey</h2>

        {loading ? (
          <div className="loading">Loading entries...</div>
        ) : entries.length === 0 ? (
          <div className="loading">No entries yet. Start documenting your journey!</div>
        ) : (
          <div className="entries-grid">
            {entries.map((entry) => (
              <div key={entry.id} className="entry-card">
                <div className={`entry-photos ${entry.photos.length === 1 ? 'single' : ''}`}>
                  {entry.photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={`${API_URL}/photos/${photo.filename}`}
                      alt={photo.original_name}
                      onClick={() => setLightboxImage(`${API_URL}/photos/${photo.filename}`)}
                    />
                  ))}
                </div>
                <div className="entry-content">
                  <div className="entry-date">{formatDate(entry.date)}</div>
                  {entry.text && <p className="entry-text">{entry.text}</p>}
                  <button
                    className="delete-entry-button"
                    onClick={() => handleDeleteEntry(entry.id)}
                  >
                    Delete Entry
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightboxImage && (
        <div className="lightbox" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} alt="Full size" />
        </div>
      )}
    </div>
  )
}

export default App
