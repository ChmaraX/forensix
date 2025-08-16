<h1 align="center" color="blue">ForensiX</h1>
<p align="center" text>Google Chrome forensic tool</p>

<p align="center">
<a href="https://github.com/ChmaraX/forensix/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center" text>Forensic tool for processing, analyzing and visually presenting Google Chrome artifacts.</p>

![forensix ui](https://i.imgur.com/sT3y7Bv.png)

## Features 
* Mounting of volume with Google Chrome data and preserving integrity trough manipulation process
  - read only
  - hash checking
* Suspect profile and behavior estimations including:
  - personal information (emails, phone nums, date of birth, gender, nation, city, adress...) 
  - Chrome metadata
    - Accounts
    - Version
  - Target system metadata
    - Operating system
    - Display resolution
    - Mobile Devices
  - Browsing history URL category classification using ML model
  - Login data frequency (most used emails and credentials)
  - Browsing activity during time periods (heatmap, barchart)
  - Most visited websites
* Browsing history
  - transition types
  - visit durations
  - avg. visit duration for most common sites
* Login data (including parsed metadata)
* Autofills
  - estimated cities and zip codes
  - estimated phone number
  - other possible addresses 
  - geolocation API (needed to be registered to Google)
* Downloads (including default download directory, download statistics...)
 - default download directory
 - download statistics
* Bookmarks
* Favicons (including all subdomains used for respective favicon)
* Cache 
  - URLs
  - content types
  - payloads (images or base64)
  - additional parsed metadata
* Volume
  - volume structure data (visual, JSON)
* Shared database to save potential evidence found by investigators


## Installation

### Requirements

- [Docker](https://docs.docker.com/install/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ChmaraX/forensix.git
   cd forensix
   ```

2. **Prepare your browser data:**
   Copy your Chrome/Brave browser data to the `data` directory:
   ```bash
   # For Chrome (replace with your actual profile path)
   cp -r "/Users/username/Library/Application Support/Google/Chrome/Default/." ./data/
   
   # For Brave (replace with your actual profile path)
   cp -r "/Users/username/Library/Application Support/BraveSoftware/Brave-Browser/Profile 2/." ./data/
   ```

3. **Build and start the application:**
   ```bash
   docker-compose up --build
   ```

**That's it!** The Docker setup will automatically:
- Build all services from source code
- Install Node.js and Python dependencies
- Download the ML model (~700MB) for URL classification
- Start all services

**Note:** The first build may take several minutes due to downloading dependencies and the ML model.

### Manual Installation (Alternative)

If you prefer to run without Docker:

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Download the ML model:**
   ```bash
   ./download-model.sh
   ```

3. **Install and start services manually:**
   ```bash
   # Server
   cd server
   npm install
   npm start
   
   # Client (in another terminal)
   cd client
   npm install
   npm start
   ```

The runninng services are listenning on:

- ForensiX UI => http://localhost:3000
- ForensiX Server => http://localhost:3001
- MongoDB => http://localhost:27017

## HTTPS/SSL

If you want to use `HTTPS` for communication between on UI or Server side, place key and certificate into `/certificates` directory in either `/server` or `/client` directory.

To generate self-signed keys:

```bash
openssl req -nodes -new -x509 -keyout server.key -out server.cert
```

Change `baseURL` protocol to https in `/client/src/axios-api.js`,
then rebuild the specific changed image:

```bash
docker-compose build <client|server>
```
