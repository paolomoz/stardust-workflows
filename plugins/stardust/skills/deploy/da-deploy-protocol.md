# DA Deploy Protocol

Reference for the headless deploy sequence: write the sanitised **body-fragment** HTML to DA via the Source API, then preview. Replaces the older `aem put` / `aem preview` / `aem publish` pipeline.

## Deploy (DA Source API + curl)

Needs an IMS token (`DA_TOKEN`; see the `da-content` / `da-auth` skills — may live in the repo `.env`, which MUST be gitignored). Also **push the code branch to GitHub first** so AEM Code Sync builds it and the branch preview renders your blocks.

```bash
ORG=<daOrg>; REPO=<daRepo>; BRANCH=<branch>; P=<path-without-extension>   # e.g. snowflake-blocks/test-1
TOKEN="$DA_TOKEN"

# 1. sanitise non-ASCII to entities (in place, idempotent) — DA corrupts raw UTF-8
node skills/deploy/scripts/sanitise.js content/$P.html

# 2. write the body fragment to DA (multipart, field name MUST be `data`, type text/html)
curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@content/$P.html;type=text/html" \
  "https://admin.da.live/source/$ORG/$REPO/$P.html"           # expect 201

# 2b. NEW image assets must be LIVE on Code Bus BEFORE the preview ingests them (#75).
#     The preview fetches every <img src>, hashes the bytes into Media Bus, and writes
#     about:error if a URL doesn't return image bytes AT THAT MOMENT. A just-pushed
#     img/<brand>/x.jpg can lose the race with Code Sync. Wait for each authored image:
for u in $(grep -oE 'https://[^"]+/img/[^"]+\.(jpg|jpeg|png|webp|svg)' content/$P.html | sort -u); do
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "$u")" = "200" ]; do sleep 3; done
done

# 3. preview (separate, required; path WITHOUT .html; ref = the code branch)
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/$ORG/$REPO/$BRANCH/$P"       # expect 200

# 3b. VERIFY no broken-image ingestion (#75) — must be 0; if not, an asset wasn't on
#     Code Bus yet. Re-run step 3 (preview is idempotent; it re-ingests and repairs).
curl -s "https://$BRANCH--$REPO--$ORG.aem.page/$P.plain.html" | grep -c about:error   # expect 0

# 4. (optional) publish to aem.live
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/live/$ORG/$REPO/$BRANCH/$P"
```

URLs: DA edit `https://da.live/#/$ORG/$REPO/$P` · preview `https://$BRANCH--$REPO--$ORG.aem.page/$P` · live `https://$BRANCH--$REPO--$ORG.aem.live/$P`. Token pre-flight: a 401 with empty body means it expired (dev tokens last ~24h) — re-auth.
