FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    xvfb \
    xauth \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (Chromium only)
RUN playwright install chromium
RUN playwright install-deps chromium

# Copy application code
COPY . .

# Create runtime directories
RUN mkdir -p browser_profile screenshots

EXPOSE 8000

# Playwright now launches Chromium with headless=False (see ats_form_fill.py)
# to render into a real X display — xvfb-run starts a virtual framebuffer
# X server, sets DISPLAY for the wrapped command, and tears it down after.
# Manually backgrounding Xvfb with `&` in a RUN step wouldn't work here:
# that process would die when the build layer's shell exits, long before
# the container ever runs.
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24", \
     "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
