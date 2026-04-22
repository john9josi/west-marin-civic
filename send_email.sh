#!/usr/bin/env bash
# Usage: ./send_email.sh "Subject" "Body text"
set -euo pipefail

SUBJECT="${1:?Usage: send_email.sh <subject> <body>}"
BODY="${2:?Usage: send_email.sh <subject> <body>}"

TO="${SPRINT_EMAIL_TO:-john.p.josi@gmail.com}"
FROM="${SPRINT_EMAIL_FROM:-john.p.josi@gmail.com}"

payload=$(jq -n \
  --arg to "$TO" \
  --arg from "$FROM" \
  --arg subject "$SUBJECT" \
  --arg body "$BODY" \
  '{
    personalizations: [{ to: [{ email: $to }] }],
    from: { email: $from },
    subject: $subject,
    content: [{ type: "text/plain", value: $body }]
  }')

http_code=$(curl -s -o /tmp/sendgrid_response.json -w "%{http_code}" \
  --request POST \
  --url https://api.sendgrid.com/v3/mail/send \
  --header "Authorization: Bearer ${SENDGRID_API_KEY}" \
  --header "Content-Type: application/json" \
  --data "$payload")

if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
  echo "Email sent: $SUBJECT"
else
  echo "SendGrid error $http_code: $(cat /tmp/sendgrid_response.json)" >&2
  exit 1
fi
