<h1 align="center" color="blue">ForensiX</h1>
<p align="center" text>Google Chrome forensic tool</p>

<p align="center">
<a href="https://lgtm.com/projects/g/ChmaraX/forensix/alerts/" ><img alt="Total alerts" src="https://img.shields.io/lgtm/alerts/g/ChmaraX/forensix.svg?logo=lgtm&logoWidth=18"/></a>
</p>

<p align="center" text>Forensic tool for processing, analyzing and visually presenting Google Chrome artifacts.</p>
<p align="center" text><sub>this project was made as a part of bachelor thesis</sub></p>

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

Requirements:

- [docker](https://docs.docker.com/install/)
- [docker-compose](https://docs.docker.com/compose/install/)

Clone repository:

```bash
git clone https://github.com/ChmaraX/forensix.git
```

Put directory with Google Chrome artifacts to analyze into default project directory. Data folder will me mounted as a volume on server startup. The directory name must be named `/data` .

```bash
cp -r /Default/. /forensix/data
cp -r /Cache /forensix/data
```

To download prebuild images (recommended):
Note: If there is error, you may need to use `sudo` or set docker to not need a sudo prompt.

```bash
./install
```

Note: to build images from local source use `-b`:

```bash
./install -b
```

Wait for images to download and then start them with:

```bash
./startup
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
