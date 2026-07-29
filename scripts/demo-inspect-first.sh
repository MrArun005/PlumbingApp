#!/usr/bin/env bash
#
# Live end-to-end walkthrough of the INSPECT-FIRST journey: a customer books a
# service with no price, the plumber inspects and quotes, the customer approves,
# and only then can work start.
#
# Prerequisites:
#   pnpm infra:up && pnpm db:migrate && pnpm db:seed
#   pnpm --filter @pipefix/api build && (cd apps/api && node dist/main.js)
#
# Usage: bash scripts/demo-inspect-first.sh
#
# Uses the dev-only `devCode` in the OTP response, so it needs no SMS provider.
# Reads ids straight from Postgres via docker exec — dev convenience, not a
# pattern to copy into application code.
set -euo pipefail
API=http://localhost:3000
J() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }

CUST=+919812345001
PART=+919800000003   # Manjunath S (seeded L2, Koramangala)
KEY="demo-$(date +%s)"

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# --- sessions -----------------------------------------------------------------
CODE=$(curl -s -X POST $API/auth/otp/request -H 'Content-Type: application/json' -d "{\"phone\":\"$CUST\"}" | J '["devCode"]')
TOKEN=$(curl -s -X POST $API/auth/otp/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$CUST\",\"code\":\"$CODE\"}" | J '["accessToken"]')
PCODE=$(curl -s -X POST $API/partner/auth/otp/request -H 'Content-Type: application/json' -d "{\"phone\":\"$PART\"}" | J '["devCode"]')
PTOKEN=$(curl -s -X POST $API/partner/auth/otp/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$PART\",\"code\":\"$PCODE\",\"deviceId\":\"demo-device\"}" | J '["accessToken"]')
ADDR=$(docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc "SELECT a.id FROM \"Address\" a JOIN \"User\" u ON u.id=a.\"userId\" WHERE u.phone='$CUST' LIMIT 1")
PID=$(docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc "SELECT id FROM \"Partner\" WHERE phone='$PART'")
docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "UPDATE \"Job\" SET status='COMPLETED' WHERE \"partnerId\"='$PID' AND status NOT IN ('COMPLETED','CANCELLED');" >/dev/null

step "1. Customer books a concealed-leak inspection — NO price shown"
BK=$(curl -s -X POST $API/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY-bk" \
  -d "{\"addressId\":\"$ADDR\",\"items\":[{\"sku\":\"PLB-LEAK-004\"}],\"urgencyTier\":\"E2\"}")
echo "$BK" | python3 -c "
import json,sys; b=json.load(sys.stdin)
print('   status      :', b['status'])
print('   pricingMode :', b['pricingMode'], '(forced — this SKU has no upfront price)')
print('   estimate    :', b['estimate'])
print('   customer sees:', b['whatHappensNext'])
"
BID=$(echo "$BK" | J '["id"]')

step "2. Ops assigns a plumber"
AS=$(curl -s -X POST $API/ops/assign -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' -d "{\"bookingId\":\"$BID\",\"partnerId\":\"$PID\"}")
JID=$(echo "$AS" | J '["assignment"]["jobId"]')
OTP=$(echo "$AS" | J '["assignment"]["startOtp"]')
echo "   job $JID  ·  customer start code: $OTP"

step "3. Plumber sets off, then checks in at the door (code + geofence)"
curl -s -X POST $API/partner/jobs/$JID/start -H "Authorization: Bearer $PTOKEN" | python3 -c "import json,sys;print('   ',json.load(sys.stdin)['status'])"
echo -n "   check-in from 5 km away: "
curl -s -X POST $API/partner/jobs/$JID/arrive -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' \
  -d "{\"otp\":\"$OTP\",\"lat\":12.978,\"lng\":77.641}" | python3 -c "import json,sys;d=json.load(sys.stdin);print('REFUSED —',d['message'])"
echo -n "   check-in at the door   : "
curl -s -X POST $API/partner/jobs/$JID/arrive -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' \
  -d "{\"otp\":\"$OTP\",\"lat\":12.934,\"lng\":77.622}" | python3 -c "import json,sys;print('OK —',json.load(sys.stdin)['status'])"
curl -s -X POST $API/partner/jobs/$JID/diagnose -H "Authorization: Bearer $PTOKEN" >/dev/null

step "4. Plumber inspects and sends an itemised quote — THIS is where the price appears"
Q=$(curl -s -X POST $API/partner/jobs/$JID/quote -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' -d '{
  "lines":[
    {"description":"Concealed pipe repair (slab section)","kind":"LABOUR","unitPricePaise":"185000"},
    {"description":"CPVC pipe 20mm x 2m","kind":"MATERIAL","unitPricePaise":"24000"},
    {"description":"Brass elbow + sealant","kind":"MATERIAL","unitPricePaise":"12000"}
  ],
  "reason":"Damp patch traced to a cracked joint under the bathroom floor. Needs a 2m section replaced."}')
echo "$Q" | python3 -c "
import json,sys; q=json.load(sys.stdin)['quote']
print('   reason:', q['reason'])
for l in q['lines']: print('     ', l['description'].ljust(42), l['amountLabel'].rjust(10))
print('   ── engine breakdown the customer sees ──')
for l in q['breakdown']: print('     ', l['label'].ljust(42), l['amountLabel'].rjust(10))
print('   TOTAL:', q['totalLabel'], ' | if declined, you pay only', q['declineChargeLabel'])
print('   flagged for admin review:', q['flaggedForReview'])
"
QID=$(echo "$Q" | J '["quote"]["quoteId"]')

step "5. Plumber tries to start work BEFORE approval"
curl -s -X POST $API/partner/jobs/$JID/begin-work -H "Authorization: Bearer $PTOKEN" | python3 -c "import json,sys;print('   BLOCKED —',json.load(sys.stdin)['message'])"

step "6. Customer approves in their own app"
curl -s -X POST $API/bookings/$BID/quotes/$QID/approve -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys;d=json.load(sys.stdin);print('   ',d['status'],'at',d['totalLabel'])"

step "7. Now work can begin, and finishing needs an after-photo"
curl -s -X POST $API/partner/jobs/$JID/begin-work -H "Authorization: Bearer $PTOKEN" | python3 -c "import json,sys;print('   ',json.load(sys.stdin)['status'])"
curl -s -X POST $API/partner/jobs/$JID/finish-work -H "Authorization: Bearer $PTOKEN" | python3 -c "import json,sys;d=json.load(sys.stdin);print('   finish without photo: BLOCKED —',d['message'])"
curl -s -X POST $API/partner/jobs/$JID/photos -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' -d '{"phase":"AFTER","fileKey":"photos/after.jpg"}' >/dev/null
curl -s -X POST $API/partner/jobs/$JID/finish-work -H "Authorization: Bearer $PTOKEN" | python3 -c "import json,sys;print('   after photo added ->',json.load(sys.stdin)['status'])"

step "8. The append-only audit trail for this job"
docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc \
  "SELECT '     ' || to_char(\"occurredAt\",'HH24:MI:SS') || '  ' || \"actorType\" || '  ' || \"eventType\" FROM \"JobTimelineEvent\" WHERE \"jobId\"='$JID' ORDER BY \"occurredAt\";"
