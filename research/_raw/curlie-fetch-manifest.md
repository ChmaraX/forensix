# Fetch manifest — Curlie verification (#119/#136)

All fetches performed by the researcher agent using the `agent_browser` tool and `curl`.
Generated 2026-08-08T10:20:00Z

Every URL below was retrieved with the browser tool or `curl -sI / curl -s`.
HTTP status recorded from actual response headers.

---

## Pages fetched with agent_browser

- `curlie-rdf-page.png` — HTTP 200, 139.5 KiB (PNG capture), timestamp 2026-08-08T10:18Z
  - https://curlie.org/docs/en/rdf.html
  - Title in browser: "Curlie - Download Directory Data"

- `curlie-license-page.png` — HTTP 200, 103.8 KiB (PNG capture), timestamp 2026-08-08T10:19Z
  - https://curlie.org/docs/en/license.html
  - Title in browser: "Curlie Directory License"

- `curlie-termsofuse-page.png` — HTTP 200, 144.3 KiB (PNG capture), timestamp 2026-08-08T10:20Z
  - https://curlie.org/docs/en/termsofuse.html
  - Title in browser: "Curlie - Terms of Use"

- (tried) — HTTP 404
  - https://curlie.org/docs/en/terms.html  ← non-existent; correct URL is termsofuse.html above

---

## Download endpoint — curl HEAD probes

- `https://curlie.org/directory-dl` — HTTP 302, redirects to:
  - `https://share.innkube.fim.uni-passau.de/curlie-rdf/curlie-rdf-all.tar.gz`
  - (curl response header: `location: https://share.innkube.fim.uni-passau.de/curlie-rdf/curlie-rdf-all.tar.gz`)

- `https://share.innkube.fim.uni-passau.de/curlie-rdf/curlie-rdf-all.tar.gz` — HTTP 200
  - `content-type: application/gzip`
  - `content-length: 177289960`  (≈ 177.3 MB decimal; ≈ 169 MiB)
  - `last-modified: Mon, 02 Feb 2026 21:58:48 GMT`
  - `etag: "12af142fa506bb4e8875f3af74144cf8-11"`
  - `accept-ranges: bytes`
  - Host fingerprint: `x-amz-*` response headers (S3-compatible object store); `x-ratelimit-*` headers present

---

## Bucket directory listing — curl GET

- `https://share.innkube.fim.uni-passau.de/curlie-rdf/` — HTTP 200, XML
  - Raw XML:
    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Name>curlie-rdf</Name>
      <Prefix></Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>curlie-rdf-all.tar.gz</Key>
        <LastModified>2026-02-02T21:58:48.128Z</LastModified>
        <ETag>"12af142fa506bb4e8875f3af74144cf8-11"</ETag>
        <Size>177289960</Size>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
    </ListBucketResult>
    ```
  - One file in the bucket; `<IsTruncated>false</IsTruncated>` confirms complete listing.
  - File size from bucket XML: **177,289,960 bytes** (matches HEAD).
  - `<LastModified>` from bucket: **2026-02-02T21:58:48.128Z**

---

## Page captures saved

| Filename | URL | Size |
|---|---|---|
| `curlie-rdf-page.png` | https://curlie.org/docs/en/rdf.html | 139.5 KiB |
| `curlie-license-page.png` | https://curlie.org/docs/en/license.html | 103.8 KiB |
| `curlie-termsofuse-page.png` | https://curlie.org/docs/en/termsofuse.html | 144.3 KiB |
