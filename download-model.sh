#!/bin/bash

MODEL_DIR="server/utils/predictor"
MODEL_FILE="finalized_model.sav"
COMPRESSED_FILE="finalized_model.sav.gz"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
COMPRESSED_PATH="$MODEL_DIR/$COMPRESSED_FILE"

# Create directory if it doesn't exist
mkdir -p "$MODEL_DIR"

# Check if model already exists
if [ -f "$MODEL_PATH" ]; then
    echo "✅ ML model already exists at $MODEL_PATH"
    exit 0
fi

echo "📥 Downloading compressed ML model (~200-300MB)..."

# Download compressed model
GITHUB_RELEASE_URL="https://github.com/ChmaraX/forensix/releases/download/v1.0/finalized_model.sav.gz"

# Try to download the compressed model
if command -v curl >/dev/null 2>&1; then
    curl -L -o "$COMPRESSED_PATH" "$GITHUB_RELEASE_URL"
elif command -v wget >/dev/null 2>&1; then
    wget -O "$COMPRESSED_PATH" "$GITHUB_RELEASE_URL"
else
    echo "❌ Error: Neither curl nor wget is available."
    echo "Please install curl or wget, or download the model manually:"
    echo "URL: $GITHUB_RELEASE_URL"
    echo "Save to: $COMPRESSED_PATH"
    exit 1
fi

# Verify download and extract
if [ -f "$COMPRESSED_PATH" ]; then
    echo "✅ Compressed model downloaded! Extracting..."
    gunzip "$COMPRESSED_PATH"
    
    if [ -f "$MODEL_PATH" ]; then
        MODEL_SIZE=$(du -h "$MODEL_PATH" | cut -f1)
        echo "✅ Model extracted successfully! Size: $MODEL_SIZE"
        echo "📍 Location: $MODEL_PATH"
    else
        echo "❌ Extraction failed."
        exit 1
    fi
else
    echo "❌ Download failed. Please try again or download manually."
    exit 1
fi
