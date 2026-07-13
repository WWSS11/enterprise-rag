import os

# Unit and API tests use the deterministic trusted-header adapter. OIDC behavior is
# covered separately with generated keys and does not depend on a running Keycloak.
os.environ["APP_AUTH_MODE"] = "trusted_header"
os.environ["APP_IDENTITY_HEADER_SECRET"] = ""
