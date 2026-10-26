/**
 * Which host a recorded row is "on", for Sites, as core decides it: the
 * same module core's Sites queries key hosts with (core/src/site-host-key.ts
 * is import- and Node-free, so the bundle includes it as is). The client
 * keys a Host link, a cell link or a Most visited host only through these,
 * so it can never name a host Sites does not list the row under.
 *
 *  - `siteHostKey(text)`: a URL's hostname or a cookie host key, one leading
 *    dot removed, lower case (`www.example.com` stays apart from
 *    `example.com`);
 *  - `cacheResourceUrl(key)`: the resource URL a cache key names;
 *  - `siteHostsOf(kind, fields)`: the hosts a row is on, from the fields,
 *    per kind, that put a row on a host (core's `SITE_HOST_FIELDS`).
 */
export {
  cacheResourceUrl,
  siteHostKey,
  siteHostsOf,
} from "../../core/src/site-host-key.js";
