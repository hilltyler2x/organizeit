"""Revokes the Apple Development certificates that earlier TestFlight runs created.

Each run starts on a fresh Mac with an empty keychain, so Xcode's automatic signing makes a
new development certificate to archive with. Apple allows only a few, so after a while the
archive fails with "Your account has reached the maximum number of certificates". This
script deletes the ones Xcode made through the App Store Connect API key (named
"Created via API"), leaving any certificate made another way alone. Revoking them doesn't
affect TestFlight or App Store builds, which are signed with the distribution certificate.

Needs ASC_KEY_ID, ASC_ISSUER_ID and the key file path in ASC_KEY_PATH.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

import jwt  # PyJWT, with the cryptography extra for ES256

API = "https://api.appstoreconnect.apple.com/v1"
DEV_TYPES = {"DEVELOPMENT", "IOS_DEVELOPMENT"}
CI_MARKER = "created via api"


def token() -> str:
    with open(os.environ["ASC_KEY_PATH"]) as f:
        key = f.read()
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
        key,
        algorithm="ES256",
        headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
    )


def call(method: str, url: str, auth: str):
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {auth}"})
    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read()
        return json.loads(body) if body else None


def main() -> int:
    auth = token()
    certs = []
    url = f"{API}/certificates?limit=200&fields[certificates]=name,displayName,certificateType,expirationDate"
    while url:
        page = call("GET", url, auth)
        certs += page["data"]
        url = page.get("links", {}).get("next")

    revoked = 0
    for cert in certs:
        attrs = cert["attributes"]
        label = f'{attrs.get("certificateType")} "{attrs.get("name")}" / "{attrs.get("displayName")}"'
        names = f'{attrs.get("name") or ""} {attrs.get("displayName") or ""}'.lower()
        if attrs.get("certificateType") in DEV_TYPES and CI_MARKER in names:
            try:
                call("DELETE", f'{API}/certificates/{cert["id"]}', auth)
                revoked += 1
                print(f"Revoked {label}")
            except urllib.error.HTTPError as e:
                print(f"::warning::Could not revoke {label}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
        else:
            print(f"Kept {label}")
    print(f"Revoked {revoked} of {len(certs)} certificates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
