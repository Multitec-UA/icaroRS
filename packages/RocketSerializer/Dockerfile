# Use a lightweight Python base image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    JAVA_HOME="/usr/lib/jvm/default-java"

# Install system dependencies
# OpenJDK 17 is required for OpenRocket
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    default-jre-headless \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements file first to leverage Docker cache
COPY requirements.in /app/

# Install Python dependencies
# We use pip-tools to compile requirements.in if desired, but for now we install directly
RUN pip install --no-cache-dir -r requirements.in

# Copy the rest of the application code
COPY . /app/

# Install the package in editable mode
RUN pip install -e .

# Set the entrypoint to a shell so users can run commands
ENTRYPOINT ["/bin/bash", "-c"]
