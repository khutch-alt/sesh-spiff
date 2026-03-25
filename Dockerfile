FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app files
COPY api_server.py .
COPY index.html .
COPY app.js .
COPY style.css .

# Create uploads directory
RUN mkdir -p uploads

# Expose port (Railway will set PORT env var)
EXPOSE 8000

# Environment defaults (override in Railway dashboard)
ENV JWT_SECRET=change-me-in-production
ENV DB_PATH=/app/data/spiff.db

# Create data directory for persistent volume
RUN mkdir -p /app/data

# Start the server
CMD ["python", "api_server.py"]
