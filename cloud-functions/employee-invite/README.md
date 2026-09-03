# FarmVista Employee Invite

HTTP Google Cloud Run / Cloud Functions service used by the Add Employee and Edit Employee pages.

## Function target

`farmvistaEmployeeInvite`

## Required secrets / environment variables

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

## Security

The request must include the currently signed-in FarmVista user's Firebase ID token in:

`Authorization: Bearer <id-token>`

The function verifies the token against the selected farm Firebase project and confirms the destination phone number belongs to an active employee before sending.

## IAM note for a central deployment

If this service is deployed in the Dowson/300398089669 Google Cloud project and must also serve Borrowman, the service account running this function needs permission to read the Borrowman Firestore employee collection. Grant the runtime service account an appropriate Firestore read role in the `borrowman-farms` project.

## Suggested service name

`farmvistaemployeeinvite`

Expected Cloud Run URL when deployed in project number 300398089669:

`https://farmvistaemployeeinvite-300398089669.us-central1.run.app`
