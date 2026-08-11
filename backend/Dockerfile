FROM python:3.11-slim@sha256:78b39ef14d8e2b4d71f8dc304f1328c37df95fe0ef99477c2ae6bd3d03784553

WORKDIR /app

COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

COPY . .

RUN mkdir -p /app/data /app/uploads

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
