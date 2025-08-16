FROM nikolaik/python-nodejs:python3.11-nodejs18

# Copy Python requirements and install them
COPY requirements.txt ./
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install -qy

# Download and extract compressed ML model (much faster!)
RUN echo "📥 Downloading compressed ML model..." && \
    mkdir -p utils/predictor && \
    for i in 1 2 3; do \
        echo "Attempt $i/3..." && \
        if command -v curl >/dev/null 2>&1; then \
            curl --retry 3 --retry-delay 5 --connect-timeout 60 --max-time 300 \
                 -L -o utils/predictor/finalized_model.sav.gz \
                 "https://github.com/ChmaraX/forensix/releases/download/v1.0/finalized_model.sav.gz" && break; \
        elif command -v wget >/dev/null 2>&1; then \
            wget --tries=3 --timeout=60 --read-timeout=300 \
                 -O utils/predictor/finalized_model.sav.gz \
                 "https://github.com/ChmaraX/forensix/releases/download/v1.0/finalized_model.sav.gz" && break; \
        else \
            echo "❌ Neither curl nor wget available"; exit 1; \
        fi; \
        echo "Download failed, retrying in 5 seconds..."; \
        sleep 5; \
    done && \
    if [ -f utils/predictor/finalized_model.sav.gz ]; then \
        echo "✅ Compressed model downloaded! Extracting..." && \
        gunzip utils/predictor/finalized_model.sav.gz && \
        echo "✅ Model extracted successfully! Size: $(du -h utils/predictor/finalized_model.sav | cut -f1)"; \
    else \
        echo "❌ Model download failed after 3 attempts"; exit 1; \
    fi

# Copy application code
COPY . .

EXPOSE 3001
CMD [ "npm", "start" ]
