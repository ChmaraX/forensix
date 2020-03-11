FROM nikolaik/python-nodejs:latest

RUN pip install --upgrade pip && \
    pip install --no-cache-dir pathlib sklearn

# && \
# pip install --no-cache-dir med2image

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./

RUN npm install -qy

COPY . .

EXPOSE 3001
CMD [ "npm", "start" ]