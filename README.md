# Postpaddy Supports SDKs

This repository contains three publishable SDKs:

- `packages/supports-react-native` -> npm (`@postpaddy/supports-react-native`)
- `packages/supports-ios` -> Swift Package Manager
- `packages/supports-android` -> Maven Central (`com.postpaddy:supports-android`)

## Structure

```txt
packages/
  supports-react-native/
  supports-ios/
  supports-android/
examples/
```

## Release Order

1. Publish React Native SDK to npm.
2. Publish iOS SDK by tagging the repository.
3. Publish Android SDK to Maven Central.

## Quick Commands

### React Native

```bash
npm install
npm run build:react-native
npm run check:react-native-pack
npm --workspace @postpaddy/supports-react-native publish --access public
```

### iOS

```bash
cd packages/supports-ios
swift build
# then create and push tag from repo root
```

### Android

```bash
cd packages/supports-android
./gradlew build
./gradlew publishToMavenLocal
```

## Security

Never ship server-side secrets in SDK code. Pass only safe public values
(`workspaceId`, `appId`) or short-lived backend-issued identity tokens.
