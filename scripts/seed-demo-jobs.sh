#!/usr/bin/env bash
# Create a few realistic jobs so the plumber console has something to show.
set -euo pipefail
API=http://localhost:3000
J() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }

DAD_PHONE=+919845012345

# Make sure "Ravi" exists as an ACTIVE partner on the configured business number.
docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "
INSERT INTO \"Partner\" (id, phone, name, status, \"onlineStatus\", \"skillTier\", \"emergencyOptIn\", \"acceptanceRate7d\", \"firstVisitResolutionRate\", \"walletBalancePaise\", \"ratingAvg90d\", \"createdAt\", \"updatedAt\")
VALUES ('dad_ravi_demo', '$DAD_PHONE', 'Ravi Kumar', 'ACTIVE', 'ONLINE', 'L3', true, 1, 1, 0, 4.8, now(), now())
ON CONFLICT (phone) DO UPDATE SET status='ACTIVE', name='Ravi Kumar', \"deviceId\"=NULL;
" >/dev/null

PID=$(docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc "SELECT id FROM \"Partner\" WHERE phone='$DAD_PHONE'")
docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "UPDATE \"Job\" SET status='COMPLETED' WHERE \"partnerId\"='$PID' AND status NOT IN ('COMPLETED','CANCELLED');" >/dev/null

# Certify Ravi for every category so any SKU can be assigned to him.
docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "
INSERT INTO \"PartnerSkill\" (id, \"partnerId\", \"categoryId\", tier, \"createdAt\", \"updatedAt\")
SELECT 'skill_' || c.code || '_dad', '$PID', c.id, 'L3', now(), now() FROM \"ServiceCategory\" c
ON CONFLICT (\"partnerId\", \"categoryId\") DO NOTHING;" >/dev/null

# Two customers with real-looking Bengaluru addresses.
make_customer() {  # phone, name, line1, line2, pincode
  docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "
  INSERT INTO \"User\" (id, phone, name, \"isBlocked\", \"createdAt\", \"updatedAt\")
  VALUES (md5('$1'), '$1', '$2', false, now(), now())
  ON CONFLICT (phone) DO UPDATE SET name='$2';" >/dev/null
  UID_=$(docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc "SELECT id FROM \"User\" WHERE phone='$1'")
  docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "
  INSERT INTO \"Address\" (id, \"userId\", label, line1, line2, landmark, pincode, city, floor, \"liftAvailable\", \"gateInstructions\", \"isDefault\", \"createdAt\", \"updatedAt\")
  VALUES (md5('addr$1'), '$UID_', 'Home', '$3', '$4', '$5', '$6', 'Bengaluru', $7, $8, $9, true, now(), now())
  ON CONFLICT (id) DO NOTHING;
  UPDATE \"Address\" SET location = ST_GeogFromText('POINT(77.622 12.934)') WHERE id = md5('addr$1');" >/dev/null
}

make_customer '+919812300001' 'Asha Nair'   '221, 5th Block'  'Koramangala' 'Jyoti Nivas College' '560095' 3    true  "'Tell the guard flat 302, Sunrise Apartments'"
make_customer '+919812300002' 'Rahul Mehta' '14, 27th Main'   'HSR Layout'  'BDA Complex'         '560102' 1    false "'Green gate, ring the bell twice'"
make_customer '+919812300003' 'Latha Rao'   '8, Wind Tunnel Rd' 'Murugeshpalya' 'Old Airport Road' '560017' NULL false NULL

book_and_assign() { # phone, sku, inspectFirst
  CODE=$(curl -s -X POST $API/auth/otp/request -H 'Content-Type: application/json' -d "{\"phone\":\"$1\"}" | J '["devCode"]')
  TOKEN=$(curl -s -X POST $API/auth/otp/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$1\",\"code\":\"$CODE\"}" | J '["accessToken"]')
  ADDR=$(docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc "SELECT a.id FROM \"Address\" a JOIN \"User\" u ON u.id=a.\"userId\" WHERE u.phone='$1' LIMIT 1")
  BK=$(curl -s -X POST $API/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "Idempotency-Key: demo-$(date +%s%N)" \
    -d "{\"addressId\":\"$ADDR\",\"items\":[{\"sku\":\"$2\"}],\"urgencyTier\":\"E2\",\"inspectFirst\":$3}")
  BID=$(echo "$BK" | J '["id"]')
  STATUS=$(echo "$BK" | J '["status"]')
  # Up-front bookings must be paid before they can be assigned.
  if [ "$STATUS" = "PENDING_PAYMENT" ]; then
    ORDER=$(curl -s -X POST $API/bookings/$BID/pay -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: pay-$(date +%s%N)" | J '["gatewayOrderId"]')
    curl -s -X POST $API/webhooks/razorpay -H 'x-razorpay-signature: stub-signature' -H 'Content-Type: application/json' \
      -d "{\"event\":\"payment.captured\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_demo_$(date +%s%N)\",\"order_id\":\"$ORDER\",\"method\":\"upi\"}}}}" >/dev/null
  fi
  echo "$BID"
}

# Job 1: inspect-first concealed leak, left as "not started"
B1=$(book_and_assign '+919812300001' 'PLB-LEAK-004' true)
curl -s -X POST $API/ops/assign -H "Authorization: Bearer $(
  PC=$(curl -s -X POST $API/partner/auth/otp/request -H 'Content-Type: application/json' -d "{\"phone\":\"$DAD_PHONE\"}" | J '["devCode"]')
  curl -s -X POST $API/partner/auth/otp/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$DAD_PHONE\",\"code\":\"$PC\",\"deviceId\":\"seed-device\"}" | J '["accessToken"]'
)" -H 'Content-Type: application/json' -d "{\"bookingId\":\"$B1\",\"partnerId\":\"$PID\"}" >/dev/null

# Job 2: fixed-price WC blockage — mark it EN_ROUTE so the console shows a code prompt
B2=$(book_and_assign '+919812300002' 'PLB-DRN-004' false)
PC=$(curl -s -X POST $API/partner/auth/otp/request -H 'Content-Type: application/json' -d "{\"phone\":\"$DAD_PHONE\"}" | J '["devCode"]')
PTOKEN=$(curl -s -X POST $API/partner/auth/otp/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$DAD_PHONE\",\"code\":\"$PC\",\"deviceId\":\"seed-device\"}" | J '["accessToken"]')
# free the partner from job 1 temporarily so job 2 can be assigned
docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "UPDATE \"Job\" SET status='COMPLETED', \"completedAt\"=now() - interval '9 days' WHERE \"bookingId\"='$B1';" >/dev/null
curl -s -X POST $API/ops/assign -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' -d "{\"bookingId\":\"$B2\",\"partnerId\":\"$PID\"}" >/dev/null
J2=$(docker exec pipefix-postgres psql -U pipefix -d pipefix -tAc "SELECT id FROM \"Job\" WHERE \"bookingId\"='$B2'")
curl -s -X POST $API/partner/jobs/$J2/start -H "Authorization: Bearer $PTOKEN" >/dev/null

# A finished job in history for Asha, with a real charged amount
docker exec pipefix-postgres psql -U pipefix -d pipefix -qc "
UPDATE \"Booking\" SET \"finalTotalPaise\" = 58900, status='COMPLETED' WHERE id='$B1';" >/dev/null

echo "seeded: partner=$PID  jobs ready"
