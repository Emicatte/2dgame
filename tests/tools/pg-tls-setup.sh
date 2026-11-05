#!/usr/bin/env bash
# Creates a TLS-only PostgreSQL 16 cluster with a throw-away CA, for the TLS verification tests
# (apps/server/test/pgTls.test.ts). Debian/Ubuntu with postgresql-16 and postgresql-common; run as
# root. Nothing here is meant for production: the keys are generated locally and unprotected.
#
#   sudo tests/tools/pg-tls-setup.sh /tmp/pgtls
#   export TEST_PG_TLS_URL=postgres://scrapline:scrapline@localhost:5433/scrapline_tls_test
#   export TEST_PG_TLS_CA_FILE=/tmp/pgtls/ca.crt TEST_PG_TLS_WRONG_CA_FILE=/tmp/pgtls/wrong-ca.crt
#   pnpm --filter @scrapline/server test
set -euo pipefail
DIR="${1:-/tmp/pgtls}"
PORT="${PG_TLS_PORT:-5433}"
VER=16
mkdir -p "$DIR"
cd "$DIR"

# Test CA, a server certificate for "localhost" only, and an unrelated CA.
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=Scrapline Test CA" \
  -keyout ca.key -out ca.crt 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout server.key -out server.csr 2>/dev/null
printf "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 30 \
  -extfile server.ext -out server.crt 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=Unrelated CA" \
  -keyout wrong-ca.key -out wrong-ca.crt 2>/dev/null

if ! pg_lsclusters | awk '{print $2}' | grep -qx tls; then
  pg_createcluster "$VER" tls --port "$PORT" >/dev/null
fi
DATA="/var/lib/postgresql/$VER/tls"
CONF="/etc/postgresql/$VER/tls"
install -o postgres -g postgres -m 600 server.key "$DATA/server.key"
install -o postgres -g postgres -m 644 server.crt "$DATA/server.crt"
cat > "$CONF/conf.d/tls.conf" <<CONF_EOF
ssl = on
ssl_cert_file = '$DATA/server.crt'
ssl_key_file = '$DATA/server.key'
ssl_min_protocol_version = 'TLSv1.2'
listen_addresses = 'localhost'
CONF_EOF
# TLS only: plain TCP connections are rejected by the server itself.
cat > "$CONF/pg_hba.conf" <<HBA_EOF
local   all  postgres                 peer
hostssl all  all       127.0.0.1/32   scram-sha-256
hostssl all  all       ::1/128        scram-sha-256
host    all  all       0.0.0.0/0      reject
host    all  all       ::/0           reject
HBA_EOF
pg_ctlcluster "$VER" tls restart
su postgres -c "psql -p $PORT -qtc \"DO \\\$\\\$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='scrapline') THEN CREATE ROLE scrapline LOGIN PASSWORD 'scrapline'; END IF; END\\\$\\\$;\""
su postgres -c "psql -p $PORT -qtc \"SELECT 1 FROM pg_database WHERE datname='scrapline_tls_test'\"" | grep -q 1 ||
  su postgres -c "createdb -p $PORT -O scrapline scrapline_tls_test"
echo "TEST_PG_TLS_URL=postgres://scrapline:scrapline@localhost:$PORT/scrapline_tls_test"
echo "TEST_PG_TLS_CA_FILE=$DIR/ca.crt"
echo "TEST_PG_TLS_WRONG_CA_FILE=$DIR/wrong-ca.crt"
