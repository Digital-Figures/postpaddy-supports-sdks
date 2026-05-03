# SDK Release Checklist

## Every release

- Update `README.md`
- Update `CHANGELOG.md` (per package)
- Bump version
- Run package build/tests
- Test install from clean example app
- Create git tag
- Publish artifact

## React Native (`@postpaddy/supports-react-native`)

```bash
cd packages/supports-react-native
npm install
npm run build
npm pack --dry-run
npm version patch
npm publish --access public
```

## iOS (Swift Package Manager)

```bash
cd packages/supports-ios
swift build
cd ../..
git tag 0.1.0
git push origin 0.1.0
```

## Android (Maven Central)

```bash
cd packages/supports-android
./gradlew build
./gradlew publishToMavenLocal
# configure signing + Sonatype portal credentials
# then publish to Maven Central
```
