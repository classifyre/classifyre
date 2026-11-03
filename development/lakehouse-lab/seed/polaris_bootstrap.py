"""Create the lab catalog in Polaris and let the root principal manage it.

    python polaris_bootstrap.py http://172.19.10.21:8181

The catalog stores tables in the lab's S3 (SeaweedFS) without STS, so Polaris
cannot vend credentials: a reader brings its own storage keys.
"""

import sys

import requests

base = sys.argv[1].rstrip("/")
token = requests.post(
    f"{base}/api/catalog/v1/oauth/tokens",
    data={"grant_type": "client_credentials", "client_id": "root", "client_secret": "s3cr3t", "scope": "PRINCIPAL_ROLE:ALL"},
    timeout=30,
).json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}
catalog = {
    "catalog": {
        "name": "lab_polaris",
        "type": "INTERNAL",
        "properties": {"default-base-location": "s3://lake/polaris/"},
        "storageConfigInfo": {
            "storageType": "S3",
            "allowedLocations": ["s3://lake/polaris/"],
            "endpoint": "http://172.19.10.10:9000",
            "pathStyleAccess": True,
            "stsUnavailable": True,
            "region": "us-east-1",
        },
    }
}
response = requests.post(f"{base}/api/management/v1/catalogs", json=catalog, headers=headers, timeout=30)
print("catalog:", response.status_code, response.text[:200])
for path, body in [
    ("/api/management/v1/catalogs/lab_polaris/catalog-roles/catalog_admin/grants", {"grant": {"type": "catalog", "privilege": "CATALOG_MANAGE_CONTENT"}}),
    ("/api/management/v1/principal-roles/service_admin/catalog-roles/lab_polaris", {"catalogRole": {"name": "catalog_admin"}}),
]:
    response = requests.put(f"{base}{path}", json=body, headers=headers, timeout=30)
    print(path.rsplit("/", 1)[-1], response.status_code, response.text[:120])
