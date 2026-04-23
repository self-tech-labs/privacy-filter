# Privacy Notes

## What runs locally

- The privacy pass itself runs locally on the user's machine.
- Once the model is downloaded and cached, subsequent redaction runs are intended to stay on-device.
- The app stores cached model assets locally for reuse.

## What may touch the network

- The first model download can require network access.
- Future updates or release downloads can require network access depending on how the app is distributed.
- The project website and GitHub documentation are public web resources.

## What the tool is designed to do

Privacy Filter is designed to create a safer intermediate draft before a user
decides whether to use a hosted frontier model. It aims to catch obvious
private entities and replace them with placeholders such as
`<PRIVATE_PERSON>` or `<PRIVATE_DATE>`.

## What the tool is not designed to guarantee

- Full anonymization
- Legal compliance by itself
- Medical confidentiality by itself
- Detection of every possible identifier or sensitive inference

## User responsibility

Users must review the output before sharing it externally. If a workflow is
regulated, contractually sensitive, or covered by professional secrecy, the
user remains responsible for deciding whether the cleaned output is suitable
for downstream use.

See also [DISCLAIMER.md](../DISCLAIMER.md).
